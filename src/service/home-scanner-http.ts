import {
  HOME_SCANNER_ROUTES,
  ServiceProblem,
  type AdmitUploadRequest,
  type AudienceProjection,
  type CancelResult,
  type CaptureRecord,
  type ComponentUrls,
  type ComponentUrlsRequest,
  type CreateCaptureRequest,
  type ExpectedVersion,
  type FinalizeResult,
  type GrantRequest,
  type GrantResult,
  type HomeScannerApi,
  type HomeScannerRouteId,
  type HttpMethod,
  type MutationOptions,
  type Page,
  type PublishRequest,
  type PublishResult,
  type ReviewRequest,
  type ReviewResult,
  type RevokeResult,
  type SceneDetail,
  type SceneSummary,
  type SceneVersionDetail,
  type UploadSession,
  type UploadStatus,
  type ViewGrant,
  type ViewGrantRequest,
  type WithdrawRequest,
  type WithdrawResult,
} from './home-scanner-api'

/**
 * HTTP Home Scanner client through the User Management BFF (plan X.1, X.6).
 *
 * Status: component-tested (synthetic data only). The app never calls the API host directly and
 * this module never calls the browser network API itself: every request goes through an injected
 * transport. The vendored web-session pin (553ac3c) does not list this app yet, so the default
 * composition uses `createDisconnectedTransport()`.
 */

/** `conventions.v0.4.json` bff.path_template. */
export const BFF_PATH_TEMPLATE = '/api/v1/web-session/{app}/api/{service}{path}'
export const BFF_APP = 'home-scanner'
export const BFF_SERVICE = 'home-scanner'

export interface TransportRequest { headers: Record<string, string>; body?: unknown }
export interface TransportResponse { status: number; headers: Record<string, string>; body: unknown }
export type Transport = (method: HttpMethod, bffPath: string, request: TransportRequest) => Promise<TransportResponse>

/** Fills `{name}` placeholders. Values are URI-encoded so ids cannot add path segments. */
export function fillPath(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name]
    if (value === undefined || value === '') throw new Error(`Missing path parameter ${name}`)
    return encodeURIComponent(value)
  })
}

export function homeScannerBffPath(path: string): string {
  return BFF_PATH_TEMPLATE.replace('{app}', BFF_APP).replace('{service}', BFF_SERVICE).replace('{path}', path)
}

function query(values: Record<string, string | number | undefined>): string {
  const entries = Object.entries(values).filter((entry): entry is [string, string | number] => entry[1] !== undefined)
  return entries.length ? `?${new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString()}` : ''
}

/** A transport that is never connected: every call answers 503 dependency_unavailable without any network use. */
export function createDisconnectedTransport(): Transport {
  return async () => ({
    status: 503,
    headers: { 'Content-Type': 'application/problem+json' },
    body: {
      type: 'https://wizestay.com/problems/dependency_unavailable',
      title: 'Dependency unavailable',
      status: 503,
      code: 'dependency_unavailable',
      request_id: 'disconnected',
    },
  })
}

export function randomIdempotencyKey(): string {
  return `hsa-${crypto.randomUUID()}`
}

export class HttpHomeScannerApi implements HomeScannerApi {
  constructor(
    private readonly transport: Transport,
    private readonly idempotencyKeys: () => string = randomIdempotencyKey,
  ) {}

  private async call<T>(id: HomeScannerRouteId, params: Record<string, string>, request: { body?: unknown; query?: string; options?: MutationOptions } = {}): Promise<T> {
    const route = HOME_SCANNER_ROUTES[id]
    const headers: Record<string, string> = {}
    if (request.body !== undefined) headers['Content-Type'] = 'application/json'
    if (route.idempotent) headers['Idempotency-Key'] = request.options?.idempotencyKey || this.idempotencyKeys()
    const path = homeScannerBffPath(fillPath(route.path, params)) + (request.query || '')
    const response = await this.transport(route.method, path, { headers, body: request.body })
    if (response.status >= 200 && response.status < 300) return response.body as T
    throw ServiceProblem.fromBody(response.status, response.body)
  }

  createCapture(request: CreateCaptureRequest, options?: MutationOptions) {
    return this.call<CaptureRecord>('H01', {}, { body: request, options })
  }
  admitUpload(captureId: string, request: AdmitUploadRequest, options?: MutationOptions) {
    return this.call<UploadSession>('H02', { capture_id: captureId }, { body: request, options })
  }
  getUpload(uploadId: string) {
    return this.call<UploadStatus>('H03', { upload_id: uploadId })
  }
  reissueComponentUrls(uploadId: string, request: ComponentUrlsRequest, options?: MutationOptions) {
    return this.call<ComponentUrls>('H04', { upload_id: uploadId }, { body: request, options })
  }
  cancelUpload(uploadId: string, request: ExpectedVersion, options?: MutationOptions) {
    return this.call<CancelResult>('H05', { upload_id: uploadId }, { body: request, options })
  }
  finalizeUpload(uploadId: string, request: ExpectedVersion, options?: MutationOptions) {
    return this.call<FinalizeResult>('H06', { upload_id: uploadId }, { body: request, options })
  }
  listScenes(values: { limit?: number; cursor?: string } = {}) {
    return this.call<Page<SceneSummary>>('H07', {}, { query: query({ limit: values.limit, cursor: values.cursor }) })
  }
  getScene(sceneId: string) {
    return this.call<SceneDetail>('H08', { scene_id: sceneId })
  }
  getSceneVersion(sceneId: string, version: string) {
    return this.call<SceneVersionDetail>('H09', { scene_id: sceneId, version })
  }
  reviewVersion(sceneId: string, version: string, request: ReviewRequest, options?: MutationOptions) {
    return this.call<ReviewResult>('H10', { scene_id: sceneId, version }, { body: request, options })
  }
  getAudienceProjection(sceneId: string, version: string) {
    return this.call<AudienceProjection>('H11', { scene_id: sceneId, version })
  }
  publish(sceneId: string, request: PublishRequest, options?: MutationOptions) {
    return this.call<PublishResult>('H12', { scene_id: sceneId }, { body: request, options })
  }
  withdraw(sceneId: string, request: WithdrawRequest, options?: MutationOptions) {
    return this.call<WithdrawResult>('H13', { scene_id: sceneId }, { body: request, options })
  }
  grant(sceneId: string, request: GrantRequest, options?: MutationOptions) {
    return this.call<GrantResult>('H14', { scene_id: sceneId }, { body: request, options })
  }
  revokeGrant(sceneId: string, grantId: string, values: ExpectedVersion) {
    return this.call<RevokeResult>('H15', { scene_id: sceneId, grant_id: grantId }, { query: query({ expected_version: values.expected_version }) })
  }
  createViewGrant(sceneId: string, request: ViewGrantRequest, options?: MutationOptions) {
    return this.call<ViewGrant>('H16', { scene_id: sceneId }, { body: request, options })
  }
}
