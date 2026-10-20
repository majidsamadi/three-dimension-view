import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fixtureJson from '../../contracts/draft/v0.4/fixtures/api/home-scanner.v0.4.json'
import conventions from '../../contracts/draft/v0.4/fixtures/common/conventions.v0.4.json'
import { HOME_SCANNER_ROUTES, type HomeScannerApi, type HomeScannerRouteId } from '@/service/home-scanner-api'
import { FakeHomeScannerApi } from '@/service/home-scanner-fake'
import { HttpHomeScannerApi, fillPath, type TransportRequest } from '@/service/home-scanner-http'

interface Example { path_params: Record<string, string>; query: Record<string, string | number>; headers: Record<string, string>; body: unknown }
interface FixtureRoute { id: string; method: string; path: string; idempotency_key: string; expected_version: string; request_example: Example; response_example: unknown; response_status: number }
const fixture = fixtureJson as unknown as { bff_service: string; routes: FixtureRoute[] }
const routes = new Map(fixture.routes.map(route => [route.id, route]))

/** Recursive key structure: objects → sorted keys, arrays → first element, primitives → '*'. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? [shape(value[0])] : []
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, shape((value as Record<string, unknown>)[key])]))
  return '*'
}

type Invoke = (api: HomeScannerApi, ex: Example) => Promise<unknown>
const key = (ex: Example) => ({ idempotencyKey: ex.headers['Idempotency-Key'] })
const p = (ex: Example, name: string) => ex.path_params[name]
const body = <T>(ex: Example) => ex.body as T
const INVOKE: Record<HomeScannerRouteId, Invoke> = {
  H01: (api, ex) => api.createCapture(body(ex), key(ex)),
  H02: (api, ex) => api.admitUpload(p(ex, 'capture_id'), body(ex), key(ex)),
  H03: (api, ex) => api.getUpload(p(ex, 'upload_id')),
  H04: (api, ex) => api.reissueComponentUrls(p(ex, 'upload_id'), body(ex), key(ex)),
  H05: (api, ex) => api.cancelUpload(p(ex, 'upload_id'), body(ex), key(ex)),
  H06: (api, ex) => api.finalizeUpload(p(ex, 'upload_id'), body(ex), key(ex)),
  H07: (api, ex) => api.listScenes({ limit: Number(ex.query.limit) }),
  H08: (api, ex) => api.getScene(p(ex, 'scene_id')),
  H09: (api, ex) => api.getSceneVersion(p(ex, 'scene_id'), p(ex, 'version')),
  H10: (api, ex) => api.reviewVersion(p(ex, 'scene_id'), p(ex, 'version'), body(ex), key(ex)),
  H11: (api, ex) => api.getAudienceProjection(p(ex, 'scene_id'), p(ex, 'version')),
  H12: (api, ex) => api.publish(p(ex, 'scene_id'), body(ex), key(ex)),
  H13: (api, ex) => api.withdraw(p(ex, 'scene_id'), body(ex), key(ex)),
  H14: (api, ex) => api.grant(p(ex, 'scene_id'), body(ex), key(ex)),
  H15: (api, ex) => api.revokeGrant(p(ex, 'scene_id'), p(ex, 'grant_id'), { expected_version: Number(ex.query.expected_version) }),
  H16: (api, ex) => api.createViewGrant(p(ex, 'scene_id'), body(ex), key(ex)),
}

describe('Home Scanner client contract (v0.4 DRAFT / SYNTHETIC — NOT FROZEN)', () => {
  it('HSA X.2 fake API routes/keys equal home-scanner.v0.4.json', async () => {
    // 1. Route ids, methods, paths and idempotency flags.
    expect(Object.keys(HOME_SCANNER_ROUTES)).toEqual(fixture.routes.map(route => route.id))
    for (const route of fixture.routes) {
      const local = HOME_SCANNER_ROUTES[route.id as HomeScannerRouteId]
      expect({ method: local.method, path: local.path, idem: local.idempotent }, route.id).toEqual({ method: route.method, path: route.path, idem: route.idempotency_key === 'required' })
      expect(typeof FakeHomeScannerApi.prototype[local.operation], route.id).toBe('function')
      expect(typeof HttpHomeScannerApi.prototype[local.operation], route.id).toBe('function')
    }

    // 2. Every fake response has the fixture's key set, driven through one synthetic flow.
    const fake = new FakeHomeScannerApi()
    const actual: Partial<Record<HomeScannerRouteId, unknown>> = {}
    const ex = (id: string) => routes.get(id)!.request_example
    const glb = new Uint8Array(readFileSync('contracts/draft/v0.4/fixtures/assets/synthetic-unit-box.glb'))
    const capture = await fake.createCapture(body(ex('H01')), { idempotencyKey: 'idem-capture-0001' })
    actual.H01 = capture
    const upload = await fake.admitUpload(capture.capture_id, body(ex('H02')), { idempotencyKey: 'idem-upload-0001' })
    actual.H02 = upload
    actual.H04 = await fake.reissueComponentUrls(upload.upload_id, { component_ids: ['main'] }, { idempotencyKey: 'idem-urls-0001' })
    expect(await fake.putComponent(upload.components[0].put_url, upload.components[0].put_headers, glb)).toEqual({ status: 200 })
    actual.H03 = await fake.getUpload(upload.upload_id)
    const other = await fake.admitUpload(capture.capture_id, body(ex('H02')), { idempotencyKey: 'idem-upload-0002' })
    actual.H05 = await fake.cancelUpload(other.upload_id, { expected_version: other.record_version }, { idempotencyKey: 'idem-cancel-0001' })
    const final = await fake.finalizeUpload(upload.upload_id, { expected_version: upload.record_version }, { idempotencyKey: 'idem-finalize-0001' })
    actual.H06 = final
    expect(final.state).toBe('validated')
    let scene = await fake.getScene(final.scene_id)
    actual.H10 = await fake.reviewVersion(final.scene_id, final.version, { ...body<object>(ex('H10')), expected_version: scene.record_version } as never, { idempotencyKey: 'idem-review-0001' })
    const projection = await fake.getAudienceProjection(final.scene_id, final.version)
    actual.H11 = projection
    scene = await fake.getScene(final.scene_id)
    actual.H12 = await fake.publish(final.scene_id, { version: final.version, projection_id: projection.projection_id, expected_version: scene.record_version }, { idempotencyKey: 'idem-publish-0001' })
    actual.H07 = await fake.listScenes({ limit: 20 })
    actual.H08 = await fake.getScene(final.scene_id)
    actual.H09 = await fake.getSceneVersion(final.scene_id, final.version)
    const grant = await fake.grant(final.scene_id, { grantee_user_id: 'USER-B', expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z') }, { idempotencyKey: 'idem-grant-0001' })
    actual.H14 = grant
    actual.H16 = await fake.createViewGrant(final.scene_id, { version: final.version }, { idempotencyKey: 'idem-view-0001' })
    actual.H15 = await fake.revokeGrant(final.scene_id, grant.grant_id, { expected_version: 1 })
    scene = await fake.getScene(final.scene_id)
    actual.H13 = await fake.withdraw(final.scene_id, { expected_version: scene.record_version, reason: 'synthetic withdrawal' }, { idempotencyKey: 'idem-withdraw-0001' })
    for (const route of fixture.routes) expect(shape(actual[route.id as HomeScannerRouteId]), route.id).toEqual(shape(route.response_example))
    // Jobs (HSB-04.2–04.4) are disabled (Q02): the client has no such operation.
    expect(Object.values(HOME_SCANNER_ROUTES).some(route => route.path.includes('/jobs'))).toBe(false)

    // 3. The BFF path for every route is the conventions template plus the fixture path.
    for (const route of fixture.routes) {
      const sent: Array<{ method: string; path: string; request: TransportRequest }> = []
      const api = new HttpHomeScannerApi(async (method, path, request) => { sent.push({ method, path, request }); return { status: route.response_status, headers: {}, body: route.response_example } }, () => 'generated-key-0001')
      const ex = route.request_example
      expect(await INVOKE[route.id as HomeScannerRouteId](api, ex), route.id).toEqual(route.response_example)
      const query = Object.keys(ex.query).length ? `?${new URLSearchParams(Object.entries(ex.query).map(([k, v]) => [k, String(v)]))}` : ''
      const expected = conventions.bff.path_template.replace('{app}', 'home-scanner').replace('{service}', fixture.bff_service).replace('{path}', fillPath(route.path, ex.path_params)) + query
      expect(sent, route.id).toHaveLength(1)
      expect(sent[0].method, route.id).toBe(route.method)
      expect(sent[0].path, route.id).toBe(expected)
      expect(sent[0].request.headers['Idempotency-Key'], route.id).toBe(route.idempotency_key === 'required' ? ex.headers['Idempotency-Key'] : undefined)
      expect(sent[0].request.body ?? null, route.id).toEqual(ex.body)
      for (const header of Object.keys(sent[0].request.headers)) expect(conventions.bff.request_headers_passed, `${route.id} ${header}`).toContain(header)
      for (const segment of expected.replace('/api/v1/web-session/home-scanner/api/home-scanner', '').split('/')) expect(conventions.bff.forbidden_path_segments).not.toContain(segment)
    }
  })

  it('maps problem bodies and the disconnected transport to ServiceProblem', async () => {
    const { createDisconnectedTransport } = await import('@/service/home-scanner-http')
    const api = new HttpHomeScannerApi(createDisconnectedTransport())
    await expect(api.getScene('scn_01HZYSYNTH0000000000000001')).rejects.toMatchObject({ status: 503, code: 'dependency_unavailable' })
    const conflict = new HttpHomeScannerApi(async () => ({ status: 409, headers: {}, body: { code: 'version_conflict', status: 409, title: 'Version conflict', current_version: 4 } }))
    await expect(conflict.publish('scn_x', { version: '1', projection_id: 'prj_x', expected_version: 3 })).rejects.toMatchObject({ code: 'version_conflict', currentVersion: 4 })
    await expect(api.getScene('../internal')).rejects.toMatchObject({ code: 'dependency_unavailable' })
    let path = ''
    await new HttpHomeScannerApi(async (_m, p) => { path = p; return { status: 200, headers: {}, body: {} } }).getScene('../internal')
    expect(path).toBe('/api/v1/web-session/home-scanner/api/home-scanner/home-scenes/..%2Finternal')
  })
})
