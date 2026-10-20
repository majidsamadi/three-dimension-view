/**
 * Home Scanner API port (plan X.2.2 table H, v0.4 DRAFT / SYNTHETIC — NOT FROZEN).
 *
 * Status: component-tested (synthetic data only). One method per H route. Request and response
 * shapes are transcribed from `contracts/draft/v0.4/fixtures/api/home-scanner.v0.4.json`.
 * No live backend is called from this module.
 */

export type Vec3 = [number, number, number]
export interface BoundsM { min: Vec3; max: Vec3 }
export type ContentClass = 'synthetic' | 'permitted-unoccupied-reference' | 'occupied'
export type ScaleClaim = 'unknown' | 'estimated' | 'seller-declared' | 'reference-supported' | 'independently-verified'
export type ComponentRole = 'geometry' | 'review_model' | 'diagnostics'

export interface ComponentDescriptor {
  component_id: string
  role: ComponentRole
  media_type: 'model/gltf-binary'
  sha256: string
  bytes: number
}

export interface UnobservedRegion { region_id: string; bounds_m: BoundsM; label: string }

/** `wisestay.asset-envelope.v1` (X.2.1). Drafts send `asset_id`, `version` and `audience_projection_id` as null. */
export interface AssetEnvelope {
  schema: 'wisestay.asset-envelope.v1'
  asset_id: string | null
  kind: 'home' | 'object' | 'shop'
  version: string | null
  producer: { engine: string; engine_version: string; app: string }
  components: ComponentDescriptor[]
  frame: { handedness: 'right'; up: '+Y'; units: 'metre' }
  bounds_m: BoundsM
  scale_claim: ScaleClaim
  unobserved_regions: UnobservedRegion[]
  provenance: { capture_mode: 'local'; cloud_refinement: false; content_class: ContentClass; permission_record_id: string | null }
  audience_projection_id: string | null
}

export interface MutationOptions {
  /** Reuse a key to replay the same logical request (lost acknowledgement). A new key is generated when absent. */
  idempotencyKey?: string
}

// H01
export interface CreateCaptureRequest {
  property_id: string
  kind: 'home' | 'shop'
  purpose: 'listing_tour' | 'planning' | 'shop_map'
  capture_mode: 'local'
  content_class: ContentClass
  permission_record_id: string | null
  consent: { upload_processed_representation: true }
  local_draft_ref?: string
}
export interface CaptureRecord {
  capture_id: string
  property_id: string
  property_type: 'REAL' | 'VIRTUAL'
  kind: 'home' | 'shop'
  state: 'open'
  record_version: number
  created_at: string
}

// H02–H06
export interface AdmitUploadRequest { envelope: AssetEnvelope; components: ComponentDescriptor[] }
export interface ComponentUrl { component_id: string; put_url: string; put_headers: Record<string, string>; url_expires_at: string }
export interface UploadSession {
  upload_id: string
  capture_id: string
  state: 'open'
  expires_at: string
  record_version: number
  components: Array<ComponentUrl & { state: 'pending' }>
}
export type ComponentState = 'pending' | 'confirmed' | 'failed'
export type ComponentReason = 'digest_mismatch' | 'size_mismatch'
export interface UploadComponentStatus { component_id: string; state: ComponentState; reason: ComponentReason | null }
export interface UploadStatus {
  upload_id: string
  capture_id: string
  state: 'open' | 'finalizing' | 'finalized' | 'cancelled' | 'expired'
  expires_at: string
  record_version: number
  components: UploadComponentStatus[]
}
export interface ComponentUrlsRequest { component_ids?: string[] }
export interface ComponentUrls { components: ComponentUrl[] }
export interface ExpectedVersion { expected_version: number }
export interface CancelResult { state: 'cancelled' }
export interface FinalizeResult {
  scene_id: string
  version: string
  state: 'validated' | 'quarantined'
  validation: { reasons: string[] }
  envelope_sha256: string
}

// H07–H09
export interface Page<T> { items: T[]; next_cursor: string | null }
export type SceneRole = 'owner' | 'grantee'
export type PublicationState = 'unpublished' | 'published' | 'withdrawn'
export type ReviewState = 'draft' | 'review_ready' | 'approved' | 'rejected'
export interface SceneSummary {
  scene_id: string
  property_id: string
  kind: 'home' | 'shop'
  role: SceneRole
  publication_state: PublicationState
  published_version: string | null
}
export interface Capabilities { visual_tour: boolean; measurement: boolean; placement: boolean; missing_regions: UnobservedRegion[] }
export interface SceneVersionSummary {
  version: string
  state: 'validated' | 'quarantined'
  scale_claim: ScaleClaim
  bounds_m: BoundsM
  capabilities: Capabilities
  missing_regions: UnobservedRegion[]
  review_state: ReviewState
}
export interface SceneDetail {
  scene_id: string
  property_id: string
  kind: 'home' | 'shop'
  role: SceneRole
  versions: SceneVersionSummary[]
  publication: { state: PublicationState; published_version: string | null; superseded_versions: string[] }
  record_version: number
}
export interface SceneVersionDetail {
  scene_id: string
  version: string
  kind: 'home' | 'shop'
  state: 'validated' | 'quarantined'
  review_state: ReviewState
  envelope: AssetEnvelope
  capabilities: Capabilities
  publication_state: PublicationState
}

// H10–H13
export interface ReviewRequest {
  decision: 'review_ready' | 'approved' | 'rejected'
  review_inputs: { quality_note?: string | null; completeness_note?: string | null; dimension_evidence_note?: string | null }
  expected_version: number
}
export interface ReviewResult { version: string; review_state: ReviewState }
export type ExcludedCategory = 'raw_capture' | 'diagnostics' | 'review_model' | 'source_photos' | 'notes'
export interface AudienceProjection {
  projection_id: string
  scene_id: string
  version: string
  components: string[]
  excluded_categories: ExcludedCategory[]
  envelope_sha256: string
  audience: 'explicit_grantees'
}
export interface PublishRequest { version: string; projection_id: string; expected_version: number }
export interface PublishResult { state: 'published'; published_version: string; superseded_version: string | null; record_version: number }
export interface WithdrawRequest { expected_version: number; reason: string }
export interface WithdrawResult { state: 'withdrawn'; new_access_blocked_at: string; outstanding_view_grants_expire_by: string }

// H14–H16
export interface GrantRequest { grantee_user_id: string; expires_at: string }
export interface GrantResult { grant_id: string; grantee_user_id: string; expires_at: string; state: 'active' }
export interface RevokeResult { grant_id: string; state: 'revoked' }
export interface ViewGrantRequest { version?: string }
export interface ViewGrant {
  view_grant_id: string
  scene_id: string
  version: string
  expires_at: string
  commercial_outcome: 'allowed_no_commercial_policy'
  envelope_url: string
  components: Array<{ component_id: string; get_url: string }>
}

export interface HomeScannerApi {
  createCapture(request: CreateCaptureRequest, options?: MutationOptions): Promise<CaptureRecord>
  admitUpload(captureId: string, request: AdmitUploadRequest, options?: MutationOptions): Promise<UploadSession>
  getUpload(uploadId: string): Promise<UploadStatus>
  reissueComponentUrls(uploadId: string, request: ComponentUrlsRequest, options?: MutationOptions): Promise<ComponentUrls>
  cancelUpload(uploadId: string, request: ExpectedVersion, options?: MutationOptions): Promise<CancelResult>
  finalizeUpload(uploadId: string, request: ExpectedVersion, options?: MutationOptions): Promise<FinalizeResult>
  listScenes(query?: { limit?: number; cursor?: string }): Promise<Page<SceneSummary>>
  getScene(sceneId: string): Promise<SceneDetail>
  getSceneVersion(sceneId: string, version: string): Promise<SceneVersionDetail>
  reviewVersion(sceneId: string, version: string, request: ReviewRequest, options?: MutationOptions): Promise<ReviewResult>
  getAudienceProjection(sceneId: string, version: string): Promise<AudienceProjection>
  publish(sceneId: string, request: PublishRequest, options?: MutationOptions): Promise<PublishResult>
  withdraw(sceneId: string, request: WithdrawRequest, options?: MutationOptions): Promise<WithdrawResult>
  grant(sceneId: string, request: GrantRequest, options?: MutationOptions): Promise<GrantResult>
  revokeGrant(sceneId: string, grantId: string, query: ExpectedVersion): Promise<RevokeResult>
  createViewGrant(sceneId: string, request: ViewGrantRequest, options?: MutationOptions): Promise<ViewGrant>
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'
export type HomeScannerOperation = keyof HomeScannerApi

/** Route table H01–H16. The contract test compares it with `home-scanner.v0.4.json`. */
export const HOME_SCANNER_ROUTES = {
  H01: { operation: 'createCapture', method: 'POST', path: '/home-captures', idempotent: true },
  H02: { operation: 'admitUpload', method: 'POST', path: '/home-captures/{capture_id}/uploads', idempotent: true },
  H03: { operation: 'getUpload', method: 'GET', path: '/uploads/{upload_id}', idempotent: false },
  H04: { operation: 'reissueComponentUrls', method: 'POST', path: '/uploads/{upload_id}/component-urls', idempotent: true },
  H05: { operation: 'cancelUpload', method: 'POST', path: '/uploads/{upload_id}/cancel', idempotent: true },
  H06: { operation: 'finalizeUpload', method: 'POST', path: '/uploads/{upload_id}/finalize', idempotent: true },
  H07: { operation: 'listScenes', method: 'GET', path: '/home-scenes', idempotent: false },
  H08: { operation: 'getScene', method: 'GET', path: '/home-scenes/{scene_id}', idempotent: false },
  H09: { operation: 'getSceneVersion', method: 'GET', path: '/home-scenes/{scene_id}/versions/{version}', idempotent: false },
  H10: { operation: 'reviewVersion', method: 'POST', path: '/home-scenes/{scene_id}/versions/{version}/review', idempotent: true },
  H11: { operation: 'getAudienceProjection', method: 'GET', path: '/home-scenes/{scene_id}/versions/{version}/audience-projection', idempotent: false },
  H12: { operation: 'publish', method: 'POST', path: '/home-scenes/{scene_id}/publication', idempotent: true },
  H13: { operation: 'withdraw', method: 'POST', path: '/home-scenes/{scene_id}/withdrawal', idempotent: true },
  H14: { operation: 'grant', method: 'POST', path: '/home-scenes/{scene_id}/grants', idempotent: true },
  H15: { operation: 'revokeGrant', method: 'DELETE', path: '/home-scenes/{scene_id}/grants/{grant_id}', idempotent: false },
  H16: { operation: 'createViewGrant', method: 'POST', path: '/home-scenes/{scene_id}/view-grants', idempotent: true },
} as const satisfies Record<string, { operation: HomeScannerOperation; method: HttpMethod; path: string; idempotent: boolean }>

export type HomeScannerRouteId = keyof typeof HOME_SCANNER_ROUTES

export interface ProblemComponent { component_id: string; state: string; reason: string | null }

/** Closed X.1 problem response surfaced as an error. */
export class ServiceProblem extends Error {
  readonly status: number
  readonly code: string
  readonly currentVersion?: number
  readonly components?: ProblemComponent[]
  readonly reasons?: string[]
  readonly sceneId?: string
  readonly version?: string
  constructor(status: number, code: string, extras: { currentVersion?: number; components?: ProblemComponent[]; reasons?: string[]; sceneId?: string; version?: string; title?: string } = {}) {
    super(extras.title || `${status} ${code}`)
    this.name = 'ServiceProblem'
    this.status = status
    this.code = code
    this.currentVersion = extras.currentVersion
    this.components = extras.components
    this.reasons = extras.reasons
    this.sceneId = extras.sceneId
    this.version = extras.version
  }

  /** Build from an `application/problem+json` body. Unknown shapes become 503 dependency_unavailable. */
  static fromBody(status: number, body: unknown): ServiceProblem {
    const value = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
    const code = typeof value.code === 'string' ? value.code : status >= 500 ? 'dependency_unavailable' : 'invalid_request'
    return new ServiceProblem(status, code, {
      title: typeof value.title === 'string' ? value.title : undefined,
      currentVersion: typeof value.current_version === 'number' ? value.current_version : undefined,
      components: Array.isArray(value.components) ? value.components as ProblemComponent[] : undefined,
      reasons: Array.isArray(value.reasons) ? value.reasons.filter((item): item is string => typeof item === 'string') : undefined,
      sceneId: typeof value.scene_id === 'string' ? value.scene_id : undefined,
      version: typeof value.version === 'string' ? value.version : undefined,
    })
  }
}

export function isServiceProblem(error: unknown): error is ServiceProblem {
  return error instanceof ServiceProblem
}
