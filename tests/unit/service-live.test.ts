import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { RouterView } from 'vue-router'
import { router } from '@/router'
import {
  SERVICE_PUBLISH_COMPOSITION,
  SERVICE_UPLOAD_COMPOSITION,
  createDefaultPublishComposition,
  createDefaultUploadComposition,
  selectLiveSession,
  type ServiceUploadComposition,
} from '@/service/compositions'
import { HttpHomeScannerApi, createPresignedPut, createWebSessionTransport, type SessionLike } from '@/service/home-scanner-http'
import { ServiceProblem } from '@/service/home-scanner-api'
import { createMemoryPendingUploadStore } from '@/service/pending-upload-store'
import { WebSessionError } from '@/vendor/account-centre/web-session.mjs'

// Live web-session transport and WiseStay sign-in (wave 3 plan §6.3.1). Status: component-tested
// (synthetic data only). Every session here is an injected fake: no network.

interface FetchCall { path: string; init: RequestInit; service?: string }

class FakeSession implements SessionLike {
  enabled = true
  authenticated: boolean
  calls: FetchCall[] = []
  started: string[] = []
  logouts = 0
  restoreError: unknown
  responses: Array<Response | Error> = []
  constructor(authenticated = false) { this.authenticated = authenticated }
  async restore(): Promise<unknown> { if (this.restoreError) throw this.restoreError; return null }
  async start(path?: string): Promise<void> { this.started.push(path || '/') }
  async logout(): Promise<void> { this.logouts++; this.authenticated = false }
  async fetch(path: string, init: RequestInit = {}, service?: string): Promise<Response> {
    this.calls.push({ path, init, service })
    if (!this.authenticated) throw new WebSessionError(401, 'session_required')
    const next = this.responses.shift()
    if (!next) throw new Error('unexpected request')
    if (next instanceof Error) throw next
    if (next.status === 401) this.authenticated = false
    return next
  }
}

const json = (status: number, body: unknown, type = 'application/json') => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } })
const problem = (status: number, code: string) => json(status, { type: `https://wizestay.com/problems/${code}`, title: code, status, code, request_id: 'r1' }, 'application/problem+json')

describe('live mode selection', () => {
  it('stays disconnected with the current vendored pin, which does not register home-scanner', () => {
    expect(selectLiveSession()).toBeUndefined()
    expect(createDefaultUploadComposition().mode).toBe('disconnected')
    expect(createDefaultPublishComposition().mode).toBe('disconnected')
  })

  it('selects live only when home-scanner is registered and the session is enabled on its origin', () => {
    const constructed: string[] = []
    class Registered extends FakeSession { constructor(options: { application: string }) { super(); constructed.push(options.application) } }
    class Elsewhere extends Registered { override enabled = false }
    expect(selectLiveSession({ APPLICATIONS: {}, WebSession: Registered })).toBeUndefined()
    expect(constructed).toEqual([])
    expect(selectLiveSession({ APPLICATIONS: { 'home-scanner': 'https://home-scanner.wizestay.com' }, WebSession: Elsewhere })).toBeUndefined()
    expect(selectLiveSession({ APPLICATIONS: { 'home-scanner': 'https://home-scanner.wizestay.com' }, WebSession: Registered })).toBeInstanceOf(Registered)
    expect(constructed).toEqual(['home-scanner', 'home-scanner'])
    const live = createDefaultUploadComposition(new FakeSession())
    expect(live.mode).toBe('live')
    expect(live.account).toBeDefined()
    expect(live.properties).toEqual([])
  })
})

describe('web-session transport', () => {
  it('maps the BFF path to the backend path and service home-scanner', async () => {
    const session = new FakeSession(true)
    session.responses.push(json(200, { items: [], next_cursor: null }))
    session.responses.push(json(201, { capture_id: 'c1' }))
    const api = new HttpHomeScannerApi(createWebSessionTransport(session), () => 'key-1')
    await api.listScenes({ limit: 5 })
    await api.createCapture({ property_id: 'p1' } as never)
    expect(session.calls[0]).toMatchObject({ path: '/home-scenes?limit=5', service: 'home-scanner', init: { method: 'GET' } })
    expect(session.calls[0].init.body).toBeUndefined()
    expect(session.calls[1].path).toBe('/home-captures')
    expect(session.calls[1].init).toMatchObject({ method: 'POST', body: JSON.stringify({ property_id: 'p1' }) })
    expect(session.calls[1].init.headers).toMatchObject({ 'Content-Type': 'application/json', 'Idempotency-Key': 'key-1' })
  })

  it('a 401 from the service signals sign-out and surfaces the problem', async () => {
    const session = new FakeSession(true)
    session.responses.push(problem(401, 'identity_required'))
    const signedOut = vi.fn()
    const api = new HttpHomeScannerApi(createWebSessionTransport(session, signedOut))
    await expect(api.getScene('s1')).rejects.toMatchObject({ status: 401, code: 'identity_required' })
    expect(signedOut).toHaveBeenCalledTimes(1)
  })

  it('session errors keep their code (CSRF, session) and unknown failures are 503', async () => {
    const session = new FakeSession(true)
    session.responses.push(new WebSessionError(403, 'csrf_invalid'))
    session.responses.push(new TypeError('network down'))
    const signedOut = vi.fn()
    const api = new HttpHomeScannerApi(createWebSessionTransport(session, signedOut))
    const csrf = await api.getScene('s1').catch(error => error)
    expect(csrf).toBeInstanceOf(ServiceProblem)
    expect(csrf).toMatchObject({ status: 403, code: 'csrf_invalid' })
    await expect(api.getScene('s1')).rejects.toMatchObject({ status: 503, code: 'dependency_unavailable' })
    const signedOutSession = new FakeSession(false)
    await expect(new HttpHomeScannerApi(createWebSessionTransport(signedOutSession, signedOut)).getScene('s1')).rejects.toMatchObject({ status: 401, code: 'session_required' })
    expect(signedOut).toHaveBeenCalledTimes(1)
  })

  it('refuses paths outside the Home Scanner BFF prefix without calling the session', async () => {
    const session = new FakeSession(true)
    const response = await createWebSessionTransport(session)('GET', '/api/v1/web-session/owner/api/core/x', { headers: {} })
    expect(response.status).toBe(400)
    expect(session.calls).toEqual([])
  })

  it('presigned PUT sends only the signed headers, no credentials, https only', async () => {
    const send = vi.fn(async () => new Response(null, { status: 200 }))
    const put = createPresignedPut(send)
    await expect(put('https://bucket.example/k', { 'x-amz-checksum-sha256': 'abc' }, new Uint8Array([1, 2]))).resolves.toEqual({ status: 200 })
    expect(send).toHaveBeenCalledWith('https://bucket.example/k', expect.objectContaining({ method: 'PUT', credentials: 'omit', redirect: 'error', headers: { 'x-amz-checksum-sha256': 'abc' } }))
    await expect(put('http://bucket.example/k', {}, new Uint8Array())).rejects.toThrow(/https/)
  })
})

const Host = defineComponent({ components: { RouterView }, template: '<RouterView />' })
let wrapper: VueWrapper | undefined
beforeEach(() => { vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined) })
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.body.innerHTML = '' })

async function mountAt(path: string, provide: Record<symbol, unknown>): Promise<VueWrapper> {
  await router.push(path)
  await router.isReady()
  wrapper = mount(Host, { attachTo: document.body, global: { plugins: [router], provide } })
  await flushPromises()
  return wrapper
}
function liveUpload(session: FakeSession): ServiceUploadComposition {
  return {
    ...createDefaultUploadComposition(session),
    store: createMemoryPendingUploadStore(),
    readProject: async id => ({ id, name: 'Synthetic room', sceneCount: 1, photoCount: 0 }),
  }
}
const button = (page: VueWrapper, name: string) => page.findAll('button').find(item => item.text() === name)
const status = (page: VueWrapper) => page.get('.service-status').attributes('data-status')

describe('live service views', () => {
  it('upload: signed out offers WiseStay sign-in and blocks the upload', async () => {
    const session = new FakeSession(false)
    const page = await mountAt('/service/projects/p1/upload', { [SERVICE_UPLOAD_COMPOSITION as symbol]: liveUpload(session) })
    expect(page.get('.service-account').attributes('data-account')).toBe('signed-out')
    expect(page.text()).toContain('Home Scanner development service.')
    expect(page.text()).not.toContain('Not connected.')
    expect(page.findAll('[role="status"]')).toHaveLength(1)
    expect(page.get('#start-reason').text()).toBe('Start upload is unavailable: Sign in with WiseStay first.')
    await button(page, 'Sign in with WiseStay')!.trigger('click')
    expect(session.started).toEqual(['/service/projects/p1/upload'])
  })

  it('upload: signed in names the missing property service (Q14) and can sign out', async () => {
    const session = new FakeSession(true)
    const page = await mountAt('/service/projects/p1/upload', { [SERVICE_UPLOAD_COMPOSITION as symbol]: liveUpload(session) })
    expect(page.get('.service-account').attributes('data-account')).toBe('signed-in')
    expect(page.text()).toContain('Property service not connected (Q14).')
    expect(page.get('#start-reason').text()).toContain('Property service not connected (Q14)')
    await button(page, 'Sign out')!.trigger('click')
    await flushPromises()
    expect(session.logouts).toBe(1)
    expect(page.get('.service-account').attributes('data-account')).toBe('signed-out')
  })

  it('upload: a session error while restoring is shown with its code', async () => {
    const session = new FakeSession(false)
    session.restoreError = new WebSessionError(503, 'session_unavailable')
    const page = await mountAt('/service/projects/p1/upload', { [SERVICE_UPLOAD_COMPOSITION as symbol]: liveUpload(session) })
    expect(page.get('[role="alert"]').text()).toContain('(session_unavailable)')
    expect(page.get('.service-account').attributes('data-account')).toBe('signed-out')
  })

  it('upload: a 401 on a restored upload moves to signed-out', async () => {
    const session = new FakeSession(true)
    session.responses.push(problem(401, 'identity_required'))
    const composition = liveUpload(session)
    await composition.store.put({ projectId: 'p1', captureId: 'c1', uploadId: 'u1', recordVersion: 1, expiresAt: '2099-01-01T00:00:00Z', components: [], finalizeKey: 'k', createdAt: '2026-10-20T00:00:00Z' } as never)
    const page = await mountAt('/service/projects/p1/upload', { [SERVICE_UPLOAD_COMPOSITION as symbol]: composition })
    await vi.waitFor(() => { expect(status(page)).toBe('signed-out') })
    expect(page.get('[role="status"]').text()).toContain('You are signed out of WiseStay.')
    expect(page.get('.service-account').attributes('data-account')).toBe('signed-out')
  })

  it('publish: signed out shows the signed-out state without calling the service', async () => {
    const session = new FakeSession(false)
    const page = await mountAt('/service/scenes/s1/publish', { [SERVICE_PUBLISH_COMPOSITION as symbol]: createDefaultPublishComposition(session) })
    await vi.waitFor(() => { expect(status(page)).toBe('signed-out') })
    expect(page.get('[role="status"]').text()).toBe('You are signed out of WiseStay. Sign in to read this scene; nothing was changed.')
    expect(button(page, 'Sign in with WiseStay')).toBeDefined()
    expect(session.calls.every(call => call.path === '/home-scenes/s1')).toBe(true)
  })
})
