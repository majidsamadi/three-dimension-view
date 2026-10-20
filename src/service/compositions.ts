import type { InjectionKey } from 'vue'
import { repository } from '@/data/database'
import { cropGeometry, decodeGeometry, geometryBounds, transformGeometry } from '@/domain/geometry'
import type { RenderScene } from '@/domain/types'
import { sha256Hex } from './digest'
import { APPLICATIONS, WebSession } from '@/vendor/account-centre/web-session.mjs'
import { BFF_APP, HttpHomeScannerApi, createDisconnectedTransport, createPresignedPut, createWebSessionTransport, type SessionLike } from './home-scanner-http'
import type { AssetEnvelope, BoundsM, ContentClass, CreateCaptureRequest, HomeScannerApi, ScaleClaim, UnobservedRegion } from './home-scanner-api'
import { idbPendingUploadStore, type PendingUploadStore } from './pending-upload-store'
import type { LocalComponent, PutComponent, UploadSelection } from './upload-transfer'

/**
 * Compositions for the service-mode views.
 *
 * Status: component-tested (synthetic data only). The default composition is disconnected:
 * `HttpHomeScannerApi(createDisconnectedTransport())` answers 503 to every call and the default
 * component PUT never touches the network. Live mode is selected only when the vendored
 * web-session client registers `home-scanner` and the page runs on that exact origin
 * (`WebSession.enabled`); with the current pin (553ac3c) it is unreachable.
 * Review-fixture compositions use `FakeHomeScannerApi` and are labelled
 * "Prototype / synthetic / not connected".
 */
export type CompositionMode = 'disconnected' | 'synthetic-fixture' | 'live'

/** Central WiseStay sign-in for live mode (user.wizestay.com through the same-origin BFF). */
export interface ServiceAccount {
  /** Re-reads the session; true when signed in. Session errors propagate with their code. */
  restore(): Promise<boolean>
  signIn(returnPath: string): Promise<void>
  signOut(): Promise<void>
  /** Called when the service or BFF answers 401. Returns an unsubscribe function. */
  onSignedOut(listener: () => void): () => void
}

export interface ServiceProject { id: string; name: string; sceneCount: number; photoCount: number }
export interface PreparedUpload { components: LocalComponent[]; bounds_m: BoundsM; scale_claim: ScaleClaim; unobserved_regions: UnobservedRegion[] }
export interface PropertyChoice { reference: string; label: string; propertyType: 'REAL' | 'VIRTUAL' }

export interface ServiceUploadComposition {
  mode: CompositionMode
  api: HomeScannerApi
  store: PendingUploadStore
  putComponent: PutComponent
  /** Canonical property contexts supplied by the property service. Empty when not connected. */
  properties: PropertyChoice[]
  /** Present only in live mode. */
  account?: ServiceAccount
  fixtureProjectId?: string
  readProject(projectId: string): Promise<ServiceProject | undefined>
  /** Builds the processed GLB and its descriptor on this device. Raw capture is never read. */
  prepare(projectId: string): Promise<PreparedUpload>
}

export interface ServicePublishComposition {
  mode: CompositionMode
  api: HomeScannerApi
  /** Present only in live mode. */
  account?: ServiceAccount
  fixtureSceneId?: string
}

export const SERVICE_UPLOAD_COMPOSITION: InjectionKey<ServiceUploadComposition> = Symbol('SERVICE_UPLOAD_COMPOSITION')
export const SERVICE_PUBLISH_COMPOSITION: InjectionKey<ServicePublishComposition> = Symbol('SERVICE_PUBLISH_COMPOSITION')

/** The default presigned PUT: not connected, never calls the network. */
export const disconnectedPut: PutComponent = async () => { throw new TypeError('Home Scanner storage is not connected in this build.') }

export async function descriptorFor(componentId: string, bytes: Uint8Array): Promise<LocalComponent> {
  return { descriptor: { component_id: componentId, role: 'geometry', media_type: 'model/gltf-binary', sha256: await sha256Hex(bytes), bytes: bytes.byteLength }, bytes }
}

async function prepareLocalProject(projectId: string): Promise<PreparedUpload> {
  const project = await repository.get(projectId)
  if (!project) throw new Error('This local project is unavailable on this device.')
  const scenes: RenderScene[] = []
  for (const scene of project.scenes) scenes.push({ scene, geometry: await decodeGeometry((await repository.asset(scene.geometryId, project.id)).blob) })
  const { exportModel } = await import('@/services/models')
  const bytes = new Uint8Array(await (await exportModel(scenes, 'glb')).arrayBuffer())
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const { scene, geometry } of scenes) {
    const bounds = geometryBounds(transformGeometry(cropGeometry(geometry, scene.crop), scene.transform))
    for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], bounds.min[axis]); max[axis] = Math.max(max[axis], bounds.max[axis]) }
  }
  // Local capture is not qualified (Q04), so the scale claim is never stronger than "unknown" here.
  return { components: [await descriptorFor('main', bytes)], bounds_m: { min, max }, scale_claim: 'unknown', unobserved_regions: [] }
}

interface WebSessionModule {
  APPLICATIONS: Readonly<Record<string, string>>
  WebSession: new (options: { application: string }) => SessionLike
}

/**
 * The live session, or undefined. Requires the vendored client to register `home-scanner` (it
 * throws for unregistered applications) and `enabled`, which is true only on the exact origin.
 */
export function selectLiveSession(module: WebSessionModule = { APPLICATIONS, WebSession }): SessionLike | undefined {
  if (!Object.hasOwn(module.APPLICATIONS, BFF_APP)) return undefined
  const session = new module.WebSession({ application: BFF_APP })
  return session.enabled ? session : undefined
}

function liveAccount(session: SessionLike): { account: ServiceAccount; signedOut: () => void } {
  const listeners = new Set<() => void>()
  return {
    signedOut: () => { for (const listener of [...listeners]) listener() },
    account: {
      async restore() { await session.restore(true); return session.authenticated },
      signIn: returnPath => session.start(returnPath),
      signOut: () => session.logout(),
      onSignedOut(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
  }
}

async function readLocalProject(projectId: string): Promise<ServiceProject | undefined> {
  const project = await repository.get(projectId)
  return project ? { id: project.id, name: project.name, sceneCount: project.scenes.length, photoCount: project.photos.length } : undefined
}

export function createDefaultUploadComposition(session: SessionLike | undefined = selectLiveSession()): ServiceUploadComposition {
  if (session) {
    const { account, signedOut } = liveAccount(session)
    // No property listing exists on this path yet: properties stay empty (Q14).
    return {
      mode: 'live',
      api: new HttpHomeScannerApi(createWebSessionTransport(session, signedOut)),
      store: idbPendingUploadStore,
      putComponent: createPresignedPut(),
      properties: [],
      account,
      readProject: readLocalProject,
      prepare: prepareLocalProject,
    }
  }
  return {
    mode: 'disconnected',
    api: new HttpHomeScannerApi(createDisconnectedTransport()),
    store: idbPendingUploadStore,
    putComponent: disconnectedPut,
    properties: [],
    readProject: readLocalProject,
    prepare: prepareLocalProject,
  }
}

export function createDefaultPublishComposition(session: SessionLike | undefined = selectLiveSession()): ServicePublishComposition {
  if (session) {
    const { account, signedOut } = liveAccount(session)
    return { mode: 'live', api: new HttpHomeScannerApi(createWebSessionTransport(session, signedOut)), account }
  }
  return { mode: 'disconnected', api: new HttpHomeScannerApi(createDisconnectedTransport()) }
}

export function buildUploadSelection(input: { projectId: string; property: PropertyChoice; contentClass: ContentClass; prepared: PreparedUpload }): UploadSelection {
  const descriptors = input.prepared.components.map(item => ({ ...item.descriptor }))
  const capture: CreateCaptureRequest = {
    property_id: input.property.reference,
    kind: 'home',
    purpose: 'listing_tour',
    capture_mode: 'local',
    content_class: input.contentClass,
    permission_record_id: null,
    consent: { upload_processed_representation: true },
    local_draft_ref: input.projectId,
  }
  // Draft envelope (X.2.1): the service assigns asset_id, version and audience_projection_id.
  const envelope: AssetEnvelope = {
    schema: 'wisestay.asset-envelope.v1',
    asset_id: null,
    kind: 'home',
    version: null,
    producer: { engine: 'three-dimension-view-arcore', engine_version: '0.2.0', app: 'home-scanner' },
    components: descriptors,
    frame: { handedness: 'right', up: '+Y', units: 'metre' },
    bounds_m: input.prepared.bounds_m,
    scale_claim: input.prepared.scale_claim,
    unobserved_regions: input.prepared.unobserved_regions,
    provenance: { capture_mode: 'local', cloud_refinement: false, content_class: input.contentClass, permission_record_id: null },
    audience_projection_id: null,
  }
  return { capture, envelope, components: input.prepared.components }
}
