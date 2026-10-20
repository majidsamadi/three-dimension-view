import { hexToBase64, sha256Hex } from './digest'
import {
  ServiceProblem,
  type AdmitUploadRequest,
  type AssetEnvelope,
  type AudienceProjection,
  type CancelResult,
  type Capabilities,
  type CaptureRecord,
  type ComponentDescriptor,
  type ComponentUrl,
  type ComponentUrls,
  type ComponentUrlsRequest,
  type ContentClass,
  type CreateCaptureRequest,
  type ExpectedVersion,
  type FinalizeResult,
  type GrantRequest,
  type GrantResult,
  type HomeScannerApi,
  type HomeScannerOperation,
  type MutationOptions,
  type Page,
  type ProblemComponent,
  type PublicationState,
  type PublishRequest,
  type PublishResult,
  type ReviewRequest,
  type ReviewResult,
  type ReviewState,
  type RevokeResult,
  type SceneDetail,
  type SceneSummary,
  type SceneVersionDetail,
  type ScaleClaim,
  type UploadComponentStatus,
  type UploadSession,
  type UploadStatus,
  type ViewGrant,
  type ViewGrantRequest,
  type WithdrawRequest,
  type WithdrawResult,
} from './home-scanner-api'

/**
 * Synthetic in-memory Home Scanner service following plan X.2 behaviour.
 *
 * Status: component-tested (synthetic data only). It is a test double and a review-fixture
 * backend, never a live service. It models the upload state machine, storage HEAD
 * reconciliation, digest mismatch, expected-version conflicts, expiry, review, publication,
 * withdrawal and grants. Scenario switches force the X.1 error paths.
 */

export interface FakeScenario {
  /** Every call answers 503 dependency_unavailable; presigned PUTs fail as network errors. */
  offline: boolean
  /** Owner-only actions answer 403 action_denied. */
  denied: boolean
  /** H12 answers 409 version_conflict. */
  conflictOnPublish: boolean
  /** Storage corrupts the stored bytes, so reconciliation reports digest_mismatch. */
  tamperComponent: boolean
  /** Upload routes H03–H06 answer 410 upload_expired. */
  expireUpload: boolean
  /** H16 for a grantee answers 403 grant_expired. */
  expireGrant: boolean
}

export type PutComponent = (url: string, headers: Record<string, string>, bytes: Uint8Array) => Promise<{ status: number }>

export const FAKE_PUT_LIFETIME_S = 900
export const FAKE_GET_LIFETIME_S = 300
export const FAKE_UPLOAD_LIFETIME_S = 7 * 24 * 3600
const GRANT_MAX_S = 90 * 24 * 3600
const EXTENT_LIMIT_M: Record<string, number> = { home: 200, shop: 500, object: 20 }
const MEASUREMENT_CLAIMS: ScaleClaim[] = ['reference-supported', 'independently-verified']
const EXCLUDED: AudienceProjection['excluded_categories'] = ['raw_capture', 'diagnostics', 'review_model', 'source_photos', 'notes']
const BUCKET = 'fake-s3://synthetic-home-scanner-assets'

interface FakeComponent { descriptor: ComponentDescriptor; stored?: Uint8Array; storedSha?: string }
interface FakeUpload {
  upload_id: string
  capture_id: string
  owner: string
  state: 'open' | 'finalized' | 'cancelled'
  expiresAt: number
  record_version: number
  envelope: AssetEnvelope
  components: Map<string, FakeComponent>
  finalized?: FinalizeResult
}
interface FakeCapture { record: CaptureRecord; owner: string; contentClass: ContentClass; sceneId?: string }
interface FakeVersion {
  version: string
  state: 'validated' | 'quarantined'
  review_state: ReviewState
  envelope: AssetEnvelope
  projection_id: string | null
  envelope_sha256: string
  reasons: string[]
}
interface FakeGrant { grant_id: string; grantee_user_id: string; expires_at: string; state: 'active' | 'revoked'; record_version: number }
interface FakeScene {
  scene_id: string
  property_id: string
  kind: 'home' | 'shop'
  owner: string
  content_class: ContentClass
  versions: FakeVersion[]
  publication: { state: PublicationState; published_version: string | null; superseded_versions: string[] }
  record_version: number
  grants: Map<string, FakeGrant>
}

export interface SeedVersion { review_state?: ReviewState; state?: 'validated' | 'quarantined'; scale_claim?: ScaleClaim }
export interface SeedScene {
  property_id?: string
  kind?: 'home' | 'shop'
  owner?: string
  content_class?: ContentClass
  versions: SeedVersion[]
  published_version?: string
}

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
const clone = <T>(value: T): T => structuredClone(value)
const problem = (status: number, code: string, extras: ConstructorParameters<typeof ServiceProblem>[2] = {}) => new ServiceProblem(status, code, extras)

export const SYNTHETIC_PROPERTY: Record<string, 'REAL' | 'VIRTUAL'> = { 'PROP-VIRTUAL-1': 'VIRTUAL', 'PROP-REAL-UNLISTED-1': 'REAL' }

export function syntheticEnvelope(components: ComponentDescriptor[], overrides: Partial<AssetEnvelope> = {}): AssetEnvelope {
  return {
    schema: 'wisestay.asset-envelope.v1',
    asset_id: null,
    kind: 'home',
    version: null,
    producer: { engine: 'three-dimension-view-arcore', engine_version: '0.2.0', app: 'home-scanner' },
    components: components.map(component => ({ ...component })),
    frame: { handedness: 'right', up: '+Y', units: 'metre' },
    bounds_m: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] },
    scale_claim: 'reference-supported',
    unobserved_regions: [{ region_id: 'r1', bounds_m: { min: [0.25, 0.75, 0.25], max: [0.5, 1, 0.5] }, label: 'Not observed' }],
    provenance: { capture_mode: 'local', cloud_refinement: false, content_class: 'synthetic', permission_record_id: null },
    audience_projection_id: null,
    ...overrides,
  }
}

function capabilities(version: FakeVersion): Capabilities {
  return {
    visual_tour: version.state === 'validated' && version.envelope.components.some(component => component.role === 'geometry'),
    measurement: MEASUREMENT_CLAIMS.includes(version.envelope.scale_claim),
    placement: version.envelope.scale_claim !== 'unknown',
    missing_regions: clone(version.envelope.unobserved_regions),
  }
}

export class FakeHomeScannerApi implements HomeScannerApi {
  readonly scenario: FakeScenario = { offline: false, denied: false, conflictOnPublish: false, tamperComponent: false, expireUpload: false, expireGrant: false }
  /** Every API operation in call order, for assertions such as "no second admission". */
  readonly calls: HomeScannerOperation[] = []
  /** Every presigned PUT attempt as `<upload_id>/<component_id>`. */
  readonly puts: string[] = []
  /** The next PUT stores its bytes but its acknowledgement is lost (network error to the caller). */
  dropNextPutAck = false
  actor = 'USER-A'
  now: () => number

  private counter = 0
  private readonly captures = new Map<string, FakeCapture>()
  private readonly uploads = new Map<string, FakeUpload>()
  private readonly scenes = new Map<string, FakeScene>()
  private readonly idempotency = new Map<string, { digest: string; result: unknown }>()

  constructor(options: { now?: () => number; scenario?: Partial<FakeScenario> } = {}) {
    this.now = options.now || (() => Date.now())
    Object.assign(this.scenario, options.scenario || {})
  }

  private id(prefix: string): string {
    this.counter++
    return `${prefix}_01HZYSYNTH${String(this.counter).padStart(16, '0')}`
  }

  private enter(operation: HomeScannerOperation): void {
    this.calls.push(operation)
    if (this.scenario.offline) throw problem(503, 'dependency_unavailable')
  }

  private async idempotent<T>(operation: HomeScannerOperation, options: MutationOptions | undefined, body: unknown, run: () => Promise<T> | T): Promise<T> {
    const key = options?.idempotencyKey
    if (key !== undefined && !/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw problem(400, 'idempotency_key_required')
    const scope = key ? `${this.actor}:${operation}:${key}` : undefined
    const digest = JSON.stringify(body)
    const stored = scope ? this.idempotency.get(scope) : undefined
    if (stored) {
      if (stored.digest !== digest) throw problem(409, 'idempotency_key_reuse')
      return clone(stored.result as T)
    }
    const result = await run()
    if (scope) this.idempotency.set(scope, { digest, result: clone(result) })
    return result
  }

  private ownedUpload(uploadId: string): FakeUpload {
    const upload = this.uploads.get(uploadId)
    if (!upload || upload.owner !== this.actor) throw problem(404, 'not_found')
    if (this.scenario.expireUpload || this.now() > upload.expiresAt) throw problem(410, 'upload_expired')
    return upload
  }

  private visibleScene(sceneId: string): { scene: FakeScene; role: 'owner' | 'grantee' } {
    const scene = this.scenes.get(sceneId)
    if (!scene) throw problem(404, 'not_found')
    if (scene.owner === this.actor) return { scene, role: 'owner' }
    if (this.activeGrant(scene)) return { scene, role: 'grantee' }
    throw problem(404, 'not_found')
  }

  private ownedScene(sceneId: string): FakeScene {
    const { scene, role } = this.visibleScene(sceneId)
    if (role !== 'owner' || this.scenario.denied) throw problem(403, 'action_denied')
    return scene
  }

  private activeGrant(scene: FakeScene): FakeGrant | undefined {
    return [...scene.grants.values()].find(grant => grant.grantee_user_id === this.actor && grant.state === 'active' && Date.parse(grant.expires_at) > this.now())
  }

  private expect(current: number, expected: number): void {
    if (current !== expected) throw problem(409, 'version_conflict', { currentVersion: current })
  }

  private findVersion(scene: FakeScene, version: string): FakeVersion {
    const found = scene.versions.find(item => item.version === version)
    if (!found) throw problem(404, 'not_found')
    return found
  }

  private putUrl(upload: FakeUpload, componentId: string): ComponentUrl {
    const component = upload.components.get(componentId)!
    const expires = Math.floor(this.now() / 1000) + FAKE_PUT_LIFETIME_S
    return {
      component_id: componentId,
      put_url: `${BUCKET}/staging/${upload.upload_id}/${componentId}?exp=${expires}&sig=SYNTHETIC`,
      put_headers: { 'content-length': String(component.descriptor.bytes), 'x-amz-checksum-sha256': hexToBase64(component.descriptor.sha256) },
      url_expires_at: iso(expires * 1000),
    }
  }

  /** Storage HEAD reconciliation: a stored object with the declared digest and size is confirmed. */
  private reconcile(upload: FakeUpload): UploadComponentStatus[] {
    return [...upload.components.values()].map(({ descriptor, stored, storedSha }) => {
      if (!stored) return { component_id: descriptor.component_id, state: 'pending', reason: null }
      if (stored.byteLength !== descriptor.bytes) return { component_id: descriptor.component_id, state: 'failed', reason: 'size_mismatch' }
      if (storedSha !== descriptor.sha256) return { component_id: descriptor.component_id, state: 'failed', reason: 'digest_mismatch' }
      return { component_id: descriptor.component_id, state: 'confirmed', reason: null }
    })
  }

  /** Simulated presigned PUT (the storage side of H02/H04 URLs). */
  readonly putComponent: PutComponent = async (url, headers, bytes) => {
    if (this.scenario.offline) throw new TypeError('Synthetic network failure')
    const match = /^fake-s3:\/\/synthetic-home-scanner-assets\/staging\/([^/]+)\/([^?]+)\?exp=(\d+)&sig=SYNTHETIC$/.exec(url)
    if (!match) return { status: 403 }
    const [, uploadId, componentId, exp] = match
    this.puts.push(`${uploadId}/${componentId}`)
    if (Number(exp) * 1000 <= this.now()) return { status: 403 }
    const upload = this.uploads.get(uploadId)
    const component = upload?.components.get(componentId)
    if (!upload || !component || upload.state !== 'open') return { status: 403 }
    if (headers['content-length'] !== String(bytes.byteLength)) return { status: 400 }
    const digest = await sha256Hex(bytes)
    if (headers['x-amz-checksum-sha256'] !== hexToBase64(digest)) return { status: 400 }
    const stored = new Uint8Array(bytes)
    if (this.scenario.tamperComponent && stored.length) stored[stored.length - 1] ^= 0xff
    component.stored = stored
    component.storedSha = await sha256Hex(stored)
    if (this.dropNextPutAck) {
      this.dropNextPutAck = false
      throw new TypeError('Synthetic lost acknowledgement')
    }
    return { status: 200 }
  }

  async createCapture(request: CreateCaptureRequest, options?: MutationOptions): Promise<CaptureRecord> {
    this.enter('createCapture')
    return this.idempotent('createCapture', options, request, () => {
      if (request.capture_mode !== 'local' || request.consent?.upload_processed_representation !== true) throw problem(400, 'invalid_request')
      if (request.content_class === 'occupied') throw problem(422, 'occupied_home_publication_disabled')
      const propertyType = SYNTHETIC_PROPERTY[request.property_id]
      if (!propertyType || (propertyType === 'REAL' && !request.permission_record_id)) throw problem(422, 'property_not_usable')
      const record: CaptureRecord = {
        capture_id: this.id('cap'), property_id: request.property_id, property_type: propertyType, kind: request.kind,
        state: 'open', record_version: 1, created_at: iso(this.now()),
      }
      this.captures.set(record.capture_id, { record, owner: this.actor, contentClass: request.content_class })
      return clone(record)
    })
  }

  async admitUpload(captureId: string, request: AdmitUploadRequest, options?: MutationOptions): Promise<UploadSession> {
    this.enter('admitUpload')
    return this.idempotent('admitUpload', options, { captureId, request }, () => {
      const capture = this.captures.get(captureId)
      if (!capture || capture.owner !== this.actor) throw problem(404, 'not_found')
      if (request.components.length < 1 || request.components.length > 10 || request.components.some(item => item.bytes > 209_715_200)) throw problem(413, 'limit_exceeded')
      const reasons: string[] = []
      if (request.components.some(item => (item.role as string) === 'raw_capture')) reasons.push('raw_capture_not_accepted')
      if (request.envelope.schema !== 'wisestay.asset-envelope.v1') reasons.push('envelope_schema_unsupported')
      if (request.envelope.provenance.capture_mode !== 'local') reasons.push('envelope_capture_not_local')
      if (request.envelope.provenance.cloud_refinement !== false) reasons.push('envelope_cloud_refinement_enabled')
      if (JSON.stringify(request.envelope.components) !== JSON.stringify(request.components)) reasons.push('envelope_component_invalid')
      if (reasons.length) throw problem(422, 'validation_failed', { reasons })
      const upload: FakeUpload = {
        upload_id: this.id('upl'), capture_id: captureId, owner: this.actor, state: 'open',
        expiresAt: this.now() + FAKE_UPLOAD_LIFETIME_S * 1000, record_version: 1, envelope: clone(request.envelope),
        components: new Map(request.components.map(descriptor => [descriptor.component_id, { descriptor: { ...descriptor } }])),
      }
      this.uploads.set(upload.upload_id, upload)
      return {
        upload_id: upload.upload_id, capture_id: captureId, state: 'open', expires_at: iso(upload.expiresAt), record_version: upload.record_version,
        components: request.components.map(item => ({ ...this.putUrl(upload, item.component_id), state: 'pending' as const })),
      }
    })
  }

  async getUpload(uploadId: string): Promise<UploadStatus> {
    this.enter('getUpload')
    const upload = this.ownedUpload(uploadId)
    return {
      upload_id: upload.upload_id, capture_id: upload.capture_id, state: upload.state, expires_at: iso(upload.expiresAt),
      record_version: upload.record_version, components: this.reconcile(upload),
    }
  }

  async reissueComponentUrls(uploadId: string, request: ComponentUrlsRequest, options?: MutationOptions): Promise<ComponentUrls> {
    this.enter('reissueComponentUrls')
    return this.idempotent('reissueComponentUrls', options, { uploadId, request }, () => {
      const upload = this.ownedUpload(uploadId)
      if (upload.state !== 'open') throw problem(409, 'invalid_state')
      const confirmed = new Set(this.reconcile(upload).filter(item => item.state === 'confirmed').map(item => item.component_id))
      const requested = request.component_ids || [...upload.components.keys()]
      if (requested.some(id => !upload.components.has(id))) throw problem(422, 'validation_failed', { reasons: ['unknown_component'] })
      return { components: requested.filter(id => !confirmed.has(id)).map(id => this.putUrl(upload, id)) }
    })
  }

  async cancelUpload(uploadId: string, request: ExpectedVersion, options?: MutationOptions): Promise<CancelResult> {
    this.enter('cancelUpload')
    return this.idempotent('cancelUpload', options, { uploadId, request }, () => {
      const upload = this.ownedUpload(uploadId)
      if (upload.state === 'finalized') throw problem(409, 'invalid_state')
      if (upload.state === 'cancelled') return { state: 'cancelled' as const }
      this.expect(upload.record_version, request.expected_version)
      upload.state = 'cancelled'
      upload.record_version++
      return { state: 'cancelled' as const }
    })
  }

  async finalizeUpload(uploadId: string, request: ExpectedVersion, options?: MutationOptions): Promise<FinalizeResult> {
    this.enter('finalizeUpload')
    return this.idempotent('finalizeUpload', options, { uploadId, request }, async () => {
      const upload = this.ownedUpload(uploadId)
      if (upload.state === 'finalized' && upload.finalized) throw problem(409, 'already_finalized', { sceneId: upload.finalized.scene_id, version: upload.finalized.version })
      if (upload.state === 'cancelled') throw problem(409, 'invalid_state')
      this.expect(upload.record_version, request.expected_version)
      const status = this.reconcile(upload)
      const components: ProblemComponent[] = status.map(item => ({ ...item }))
      if (status.some(item => item.state === 'pending')) throw problem(409, 'upload_incomplete', { components })
      if (status.some(item => item.reason === 'size_mismatch')) throw problem(422, 'component_size_mismatch', { components })
      if (status.some(item => item.reason === 'digest_mismatch')) throw problem(422, 'component_digest_mismatch', { components })
      const reasons = this.validate(upload)
      const capture = this.captures.get(upload.capture_id)!
      const scene = this.sceneFor(capture)
      const versionNumber = String(scene.versions.length + 1)
      const envelope: AssetEnvelope = { ...clone(upload.envelope), asset_id: scene.scene_id, version: versionNumber }
      const version: FakeVersion = {
        version: versionNumber, state: reasons.length ? 'quarantined' : 'validated', review_state: 'draft', envelope,
        projection_id: null, envelope_sha256: await sha256Hex(new TextEncoder().encode(JSON.stringify(envelope))), reasons,
      }
      scene.versions.push(version)
      scene.record_version++
      upload.state = 'finalized'
      upload.record_version++
      upload.finalized = { scene_id: scene.scene_id, version: versionNumber, state: version.state, validation: { reasons: [...reasons] }, envelope_sha256: version.envelope_sha256 }
      return clone(upload.finalized)
    })
  }

  /** Minimal X.2.1 checks that need no GLB parser: magic and the kind's extent limit. */
  private validate(upload: FakeUpload): string[] {
    const reasons: string[] = []
    for (const { descriptor, stored } of upload.components.values()) {
      if (descriptor.role !== 'geometry' || !stored) continue
      const magic = String.fromCharCode(...stored.subarray(0, 4))
      if (magic !== 'glTF') reasons.push('glb_bad_magic')
    }
    const { min, max } = upload.envelope.bounds_m
    const extent = Math.max(...max.map((value, axis) => value - min[axis]))
    const finite = [...min, ...max].every(Number.isFinite) && min.every((value, axis) => value <= max[axis])
    if (!finite || extent > (EXTENT_LIMIT_M[upload.envelope.kind] ?? 0)) reasons.push('bounds_extent_limit')
    return reasons
  }

  private sceneFor(capture: FakeCapture): FakeScene {
    if (capture.sceneId) return this.scenes.get(capture.sceneId)!
    const scene: FakeScene = {
      scene_id: this.id('scn'), property_id: capture.record.property_id, kind: capture.record.kind, owner: capture.owner,
      content_class: capture.contentClass, versions: [], publication: { state: 'unpublished', published_version: null, superseded_versions: [] },
      record_version: 0, grants: new Map(),
    }
    this.scenes.set(scene.scene_id, scene)
    capture.sceneId = scene.scene_id
    return scene
  }

  async listScenes(query: { limit?: number; cursor?: string } = {}): Promise<Page<SceneSummary>> {
    this.enter('listScenes')
    const limit = query.limit ?? 20
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw problem(400, 'invalid_request')
    const start = query.cursor ? Number(query.cursor) : 0
    const visible = [...this.scenes.values()].filter(scene => scene.owner === this.actor || this.activeGrant(scene))
    const items = visible.slice(start, start + limit).map(scene => ({
      scene_id: scene.scene_id, property_id: scene.property_id, kind: scene.kind, role: scene.owner === this.actor ? 'owner' as const : 'grantee' as const,
      publication_state: scene.publication.state, published_version: scene.publication.published_version,
    }))
    return { items, next_cursor: start + limit < visible.length ? String(start + limit) : null }
  }

  async getScene(sceneId: string): Promise<SceneDetail> {
    this.enter('getScene')
    const { scene, role } = this.visibleScene(sceneId)
    return {
      scene_id: scene.scene_id, property_id: scene.property_id, kind: scene.kind, role,
      versions: scene.versions.map(version => ({
        version: version.version, state: version.state, scale_claim: version.envelope.scale_claim, bounds_m: clone(version.envelope.bounds_m),
        capabilities: capabilities(version), missing_regions: clone(version.envelope.unobserved_regions), review_state: version.review_state,
      })),
      publication: clone(scene.publication),
      record_version: scene.record_version,
    }
  }

  async getSceneVersion(sceneId: string, versionId: string): Promise<SceneVersionDetail> {
    this.enter('getSceneVersion')
    const { scene } = this.visibleScene(sceneId)
    if (scene.publication.state === 'withdrawn') throw problem(410, 'resource_withdrawn')
    const version = this.findVersion(scene, versionId)
    return {
      scene_id: scene.scene_id, version: version.version, kind: scene.kind, state: version.state, review_state: version.review_state,
      envelope: { ...clone(version.envelope), audience_projection_id: version.projection_id }, capabilities: capabilities(version),
      publication_state: scene.publication.published_version === version.version ? scene.publication.state : 'unpublished',
    }
  }

  async reviewVersion(sceneId: string, versionId: string, request: ReviewRequest, options?: MutationOptions): Promise<ReviewResult> {
    this.enter('reviewVersion')
    return this.idempotent('reviewVersion', options, { sceneId, versionId, request }, () => {
      const scene = this.ownedScene(sceneId)
      const version = this.findVersion(scene, versionId)
      this.expect(scene.record_version, request.expected_version)
      const allowed: Record<ReviewState, ReviewState[]> = { draft: ['review_ready', 'approved', 'rejected'], review_ready: ['approved', 'rejected'], rejected: ['review_ready'], approved: [] }
      if (version.state === 'quarantined' || !allowed[version.review_state].includes(request.decision)) throw problem(409, 'invalid_state')
      version.review_state = request.decision
      if (request.decision === 'approved') version.projection_id = this.id('prj')
      scene.record_version++
      return { version: version.version, review_state: version.review_state }
    })
  }

  async getAudienceProjection(sceneId: string, versionId: string): Promise<AudienceProjection> {
    this.enter('getAudienceProjection')
    const scene = this.ownedScene(sceneId)
    const version = this.findVersion(scene, versionId)
    if (version.review_state !== 'approved' || !version.projection_id) throw problem(409, 'invalid_state')
    return {
      projection_id: version.projection_id, scene_id: scene.scene_id, version: version.version,
      components: version.envelope.components.filter(item => item.role === 'geometry').map(item => item.component_id),
      excluded_categories: [...EXCLUDED], envelope_sha256: version.envelope_sha256, audience: 'explicit_grantees',
    }
  }

  async publish(sceneId: string, request: PublishRequest, options?: MutationOptions): Promise<PublishResult> {
    this.enter('publish')
    return this.idempotent('publish', options, { sceneId, request }, () => {
      const scene = this.ownedScene(sceneId)
      if (this.scenario.conflictOnPublish) throw problem(409, 'version_conflict', { currentVersion: scene.record_version + 1 })
      this.expect(scene.record_version, request.expected_version)
      if (scene.content_class === 'occupied') throw problem(422, 'occupied_home_publication_disabled')
      const version = this.findVersion(scene, request.version)
      if (version.review_state !== 'approved' || version.projection_id !== request.projection_id || scene.publication.state === 'withdrawn') throw problem(409, 'invalid_state')
      const previous = scene.publication.published_version
      const superseded = previous && previous !== version.version ? previous : null
      if (superseded) scene.publication.superseded_versions.push(superseded)
      scene.publication.state = 'published'
      scene.publication.published_version = version.version
      scene.record_version++
      return { state: 'published' as const, published_version: version.version, superseded_version: superseded, record_version: scene.record_version }
    })
  }

  async withdraw(sceneId: string, request: WithdrawRequest, options?: MutationOptions): Promise<WithdrawResult> {
    this.enter('withdraw')
    return this.idempotent('withdraw', options, { sceneId, request }, () => {
      const scene = this.ownedScene(sceneId)
      this.expect(scene.record_version, request.expected_version)
      if (scene.publication.state !== 'published') throw problem(409, 'invalid_state')
      scene.publication.state = 'withdrawn'
      scene.record_version++
      const now = this.now()
      return { state: 'withdrawn' as const, new_access_blocked_at: iso(now), outstanding_view_grants_expire_by: iso(now + FAKE_GET_LIFETIME_S * 1000) }
    })
  }

  async grant(sceneId: string, request: GrantRequest, options?: MutationOptions): Promise<GrantResult> {
    this.enter('grant')
    return this.idempotent('grant', options, { sceneId, request }, () => {
      const scene = this.ownedScene(sceneId)
      if (scene.publication.state === 'withdrawn') throw problem(410, 'resource_withdrawn')
      const expires = Date.parse(request.expires_at)
      if (!Number.isFinite(expires) || expires <= this.now() || expires > this.now() + GRANT_MAX_S * 1000) throw problem(422, 'validation_failed', { reasons: ['grant_expiry_invalid'] })
      const grant: FakeGrant = { grant_id: this.id('grt'), grantee_user_id: request.grantee_user_id, expires_at: request.expires_at, state: 'active', record_version: 1 }
      scene.grants.set(grant.grant_id, grant)
      return { grant_id: grant.grant_id, grantee_user_id: grant.grantee_user_id, expires_at: grant.expires_at, state: 'active' as const }
    })
  }

  async revokeGrant(sceneId: string, grantId: string, query: ExpectedVersion): Promise<RevokeResult> {
    this.enter('revokeGrant')
    const scene = this.ownedScene(sceneId)
    const grant = scene.grants.get(grantId)
    if (!grant) throw problem(404, 'not_found')
    this.expect(grant.record_version, query.expected_version)
    grant.state = 'revoked'
    grant.record_version++
    return { grant_id: grant.grant_id, state: 'revoked' }
  }

  async createViewGrant(sceneId: string, request: ViewGrantRequest, options?: MutationOptions): Promise<ViewGrant> {
    this.enter('createViewGrant')
    return this.idempotent('createViewGrant', options, { sceneId, request }, () => {
      const scene = this.scenes.get(sceneId)
      if (!scene) throw problem(404, 'not_found')
      if (scene.publication.state === 'withdrawn') throw problem(410, 'resource_withdrawn')
      if (scene.owner !== this.actor) {
        const grants = [...scene.grants.values()].filter(item => item.grantee_user_id === this.actor)
        if (!grants.length) throw problem(404, 'not_found')
        if (this.scenario.expireGrant) throw problem(403, 'grant_expired')
        if (!grants.some(item => item.state === 'active')) throw problem(403, 'grant_revoked')
        if (!this.activeGrant(scene)) throw problem(403, 'grant_expired')
        if (scene.publication.state !== 'published' || (request.version && request.version !== scene.publication.published_version)) throw problem(409, 'invalid_state')
      }
      const versionId = request.version || scene.publication.published_version
      if (!versionId) throw problem(409, 'invalid_state')
      const version = this.findVersion(scene, versionId)
      const expires = Math.floor(this.now() / 1000) + FAKE_GET_LIFETIME_S
      return {
        view_grant_id: this.id('vgr'), scene_id: scene.scene_id, version: version.version, expires_at: iso(expires * 1000),
        commercial_outcome: 'allowed_no_commercial_policy' as const,
        envelope_url: `${BUCKET}/versions/envelopes/${scene.scene_id}/${version.version}.json?exp=${expires}&sig=SYNTHETIC`,
        components: version.envelope.components.filter(item => item.role === 'geometry').map(item => ({
          component_id: item.component_id, get_url: `${BUCKET}/versions/${item.sha256}?exp=${expires}&sig=SYNTHETIC`,
        })),
      }
    })
  }

  /** Test and review-fixture helper: write a scene directly, bypassing upload. Synthetic data only. */
  seedScene(seed: SeedScene): string {
    const scene: FakeScene = {
      scene_id: this.id('scn'), property_id: seed.property_id || 'PROP-VIRTUAL-1', kind: seed.kind || 'home', owner: seed.owner || this.actor,
      content_class: seed.content_class || 'synthetic', versions: [],
      publication: { state: seed.published_version ? 'published' : 'unpublished', published_version: seed.published_version || null, superseded_versions: [] },
      record_version: 1, grants: new Map(),
    }
    seed.versions.forEach((item, index) => {
      const component: ComponentDescriptor = { component_id: 'main', role: 'geometry', media_type: 'model/gltf-binary', sha256: 'c18f2e9260e2bc4567c7d97d1397f3240694a0c5f14beeb0d69e85b576da0b1a', bytes: 812 }
      const envelope = syntheticEnvelope([component], {
        asset_id: scene.scene_id, version: String(index + 1), scale_claim: item.scale_claim || 'reference-supported',
        provenance: { capture_mode: 'local', cloud_refinement: false, content_class: scene.content_class, permission_record_id: null },
      })
      const review = item.review_state || 'draft'
      scene.versions.push({
        version: String(index + 1), state: item.state || 'validated', review_state: review, envelope,
        projection_id: review === 'approved' ? this.id('prj') : null, envelope_sha256: '0'.repeat(64), reasons: item.state === 'quarantined' ? ['glb_bad_magic'] : [],
      })
    })
    this.scenes.set(scene.scene_id, scene)
    return scene.scene_id
  }
}
