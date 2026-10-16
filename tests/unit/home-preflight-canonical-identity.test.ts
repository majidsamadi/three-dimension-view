import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APPLICATIONS,
  CONTRACT,
  WebSession,
  type Receipt,
} from '@/vendor/account-centre/web-session.mjs'
import {
  createCanonicalHomeIdentityAdapter,
  createCanonicalHomePreflightAdapters,
} from '@/home/canonical-identity-adapter'
import {
  HomePreflightController,
  type HomeCapabilityFacts,
} from '@/home/preflight'

const USER_A = '2a8459c4-77ef-5220-9a43-d16155fcf510'
const USER_OLD = '81db9532-6f78-55a2-9d27-7baf67c0349d'
const CSRF = 'c'.repeat(64)
const local = {
  id: '11111111-1111-4111-8111-111111111111',
  revision: 4,
  name: 'Canonical adapter project',
  location: 'Local note only',
}

const capabilities: HomeCapabilityFacts = {
  capture: { state: 'unknown', detail: 'not tested here' },
  viewing: { state: 'unknown', detail: 'not tested here' },
  measurement: { state: 'unknown', detail: 'not tested here' },
  offline: { state: 'unknown', detail: 'not tested here' },
  cameraPermission: { state: 'unknown', detail: 'not requested' },
  storage: { state: 'unknown', detail: 'not tested here' },
  assets: { state: 'unknown', detail: 'not tested here' },
}

const response = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
})

function authenticatedReceipt(userId = USER_A, expiresAt = Math.floor(Date.now() / 1000) + 3600): Receipt {
  return {
    contract: CONTRACT,
    csrf: CSRF,
    authenticated: true,
    user_id: userId,
    identity_contract: 'wisestay.identity.v1',
    expires_at: expiresAt,
  }
}

type Handler = (path: string, init: RequestInit) => Promise<Response>

function canonicalFixture(handler: Handler, origin = APPLICATIONS.tenant) {
  const calls: Array<{ path: string; init: RequestInit }> = []
  const navigations: string[] = []
  const transport: typeof fetch = async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const request = init || {}
    calls.push({ path, init: request })
    return handler(path, request)
  }
  const session = new WebSession({
    application: 'tenant',
    origin,
    fetch: transport,
    navigate: (url) => { navigations.push(url) },
  })
  return { session, calls, navigations }
}

function standardHandler(receipt: Receipt): Handler {
  return async (path) => {
    if (path.endsWith('/readiness')) return response({ contract: CONTRACT, ready: true })
    if (path.endsWith('/bootstrap')) return response(receipt)
    throw new Error('Unexpected canonical operation: ' + path)
  }
}

let originalLocks: PropertyDescriptor | undefined

beforeEach(() => {
  originalLocks = Object.getOwnPropertyDescriptor(globalThis.navigator, 'locks')
  Object.defineProperty(globalThis.navigator, 'locks', {
    configurable: true,
    value: { request: async (_name: string, work: () => unknown) => work() },
  })
})

afterEach(() => {
  if (originalLocks) Object.defineProperty(globalThis.navigator, 'locks', originalLocks)
  else Reflect.deleteProperty(globalThis.navigator, 'locks')
  vi.restoreAllMocks()
})

describe('canonical Account Centre Home identity adapter', () => {
  it('maps only a current canonical receipt into Home identity facts without navigation or grants', async () => {
    const fixture = canonicalFixture(standardHandler(authenticatedReceipt()))
    const result = await createCanonicalHomeIdentityAdapter(fixture.session).readCurrent()

    expect(result).toEqual({
      state: 'available',
      userId: USER_A,
      identityContract: 'wisestay.identity.v1',
      detail: 'Current canonical Account Centre identity verified by the injected WebSession.',
    })
    expect(Object.keys(result).sort()).toEqual(['detail', 'identityContract', 'state', 'userId'])
    expect(fixture.calls.map(call => call.path)).toEqual([
      '/api/v1/web-session/tenant/readiness',
      '/api/v1/web-session/tenant/bootstrap',
    ])
    expect(fixture.navigations).toEqual([])
  })

  it('keeps anonymous canonical bootstrap distinct from verified identity', async () => {
    const fixture = canonicalFixture(standardHandler({ contract: CONTRACT, csrf: CSRF, authenticated: false }))
    const result = await createCanonicalHomeIdentityAdapter(fixture.session).readCurrent()
    expect(result.state).toBe('unavailable')
    expect(result.userId).toBeUndefined()
    expect(fixture.navigations).toEqual([])
    expect(fixture.calls.some(call => call.path.endsWith('/start'))).toBe(false)
  })

  it('does not request anything for an unregistered origin/disabled canonical session', async () => {
    const transport = vi.fn<typeof fetch>()
    const session = new WebSession({
      application: 'tenant',
      origin: 'https://unregistered.invalid',
      fetch: transport,
      navigate: vi.fn(),
    })
    expect(session.enabled).toBe(false)
    const result = await createCanonicalHomeIdentityAdapter(session).readCurrent()
    expect(result.state).toBe('unavailable')
    expect(result.userId).toBeUndefined()
    expect(transport).not.toHaveBeenCalled()
  })

  it('does not promote expired or otherwise invalid canonical receipt data', async () => {
    const fixture = canonicalFixture(standardHandler(authenticatedReceipt(USER_A, Math.floor(Date.now() / 1000) - 1)))
    const result = await createCanonicalHomeIdentityAdapter(fixture.session).readCurrent()
    expect(result.state).toBe('unknown')
    expect(result.userId).toBeUndefined()
    expect(result.detail).toContain('invalid_session_response')
    expect(fixture.navigations).toEqual([])
  })

  it('maps a canonical restore failure to non-verified identity without starting sign-in', async () => {
    const fixture = canonicalFixture(async (path) => {
      if (path.endsWith('/readiness')) return response({ contract: CONTRACT, ready: true })
      if (path.endsWith('/bootstrap')) return response({ error: { code: 'web_session_expired' } }, 401)
      throw new Error('Unexpected canonical operation: ' + path)
    })
    const result = await createCanonicalHomeIdentityAdapter(fixture.session).readCurrent()
    expect(result.state).toBe('unavailable')
    expect(result.userId).toBeUndefined()
    expect(result.detail).toContain('web_session_expired')
    expect(fixture.calls.some(call => call.path.endsWith('/start'))).toBe(false)
    expect(fixture.navigations).toEqual([])
  })

  it('keeps canonical property/action authority unavailable even after verified identity', async () => {
    const fixture = canonicalFixture(standardHandler(authenticatedReceipt()))
    const adapters = createCanonicalHomePreflightAdapters(fixture.session)
    adapters.capabilities = { async inspect() { return capabilities } }
    const controller = new HomePreflightController(local, { action: 'scan', localProjectId: local.id }, adapters)
    const result = await controller.refresh()

    expect(result.identity.state).toBe('available')
    expect(result.identity.identityContract).toBe('wisestay.identity.v1')
    expect(result.propertyFacts.state).toBe('unavailable')
    expect(result.propertyFacts.contexts).toEqual([])
    expect(result.selectedPropertyRef).toBeUndefined()
    expect(result.localProject).toEqual(local)
  })

  it('does not let a delayed old canonical restore repopulate Home after clear/account invalidation', async () => {
    let releaseBootstrap!: () => void
    let markBootstrapStarted!: () => void
    const bootstrapStarted = new Promise<void>(resolve => { markBootstrapStarted = resolve })
    const waiting = new Promise<void>(resolve => { releaseBootstrap = resolve })
    const fixture = canonicalFixture(async (path) => {
      if (path.endsWith('/readiness')) return response({ contract: CONTRACT, ready: true })
      if (path.endsWith('/bootstrap')) {
        markBootstrapStarted()
        await waiting
        return response(authenticatedReceipt(USER_OLD))
      }
      throw new Error('Unexpected canonical operation: ' + path)
    })
    const adapters = createCanonicalHomePreflightAdapters(fixture.session)
    adapters.capabilities = { async inspect() { return capabilities } }
    const controller = new HomePreflightController(local, { action: 'scan', localProjectId: local.id }, adapters)

    const pending = controller.refresh()
    await bootstrapStarted
    fixture.session.clear()
    const invalidated = controller.invalidateAccountContext('Canonical account context changed.')
    releaseBootstrap()
    await pending

    const final = controller.snapshot()
    expect(final.contextRevision).toBe(invalidated.contextRevision)
    expect(final.identity.state).toBe('unavailable')
    expect(final.identity.userId).toBeUndefined()
    expect(final.propertyFacts.contexts).toEqual([])
    expect(final.selectedPropertyRef).toBeUndefined()
    expect(final.localProject).toEqual(local)
    expect(fixture.navigations).toEqual([])
  })
})
