// @vitest-environment node
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
  isCurrentReceipt,
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
    let requests = 0
    let navigations = 0
    const transport: typeof fetch = async () => {
      requests++
      throw new Error('Disabled canonical session must not issue a request.')
    }
    const session = new WebSession({
      application: 'tenant',
      origin: 'https://unregistered.invalid',
      fetch: transport,
      navigate: () => { navigations++ },
    })
    expect(session.enabled).toBe(false)
    const result = await createCanonicalHomeIdentityAdapter(session).readCurrent()
    expect(result.state).toBe('unavailable')
    expect(result.userId).toBeUndefined()
    expect(requests).toBe(0)
    expect(navigations).toBe(0)
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


  it('distinguishes a current receipt from a superseded same-user receipt and refuses stale adapter mapping', async () => {
    let generation = 0
    const fixture = canonicalFixture(async (path) => {
      if (path.endsWith('/readiness')) return response({ contract: CONTRACT, ready: true })
      if (path.endsWith('/bootstrap')) {
        generation++
        return response(authenticatedReceipt(USER_A, Math.floor(Date.now() / 1000) + 3600 + generation))
      }
      throw new Error('Unexpected canonical operation: ' + path)
    })

    const first = await fixture.session.restore()
    if (!first) throw new Error('Expected first canonical receipt.')
    expect(isCurrentReceipt(fixture.session, first)).toBe(true)

    fixture.session.clear()
    const second = await fixture.session.restore()
    if (!second) throw new Error('Expected replacement canonical receipt.')
    expect(second.user_id).toBe(first.user_id)
    expect(second).not.toBe(first)
    expect(isCurrentReceipt(fixture.session, first)).toBe(false)
    expect(isCurrentReceipt(fixture.session, second)).toBe(true)

    const staleRestore = vi.spyOn(fixture.session, 'restore').mockResolvedValueOnce(first)
    const stale = await createCanonicalHomeIdentityAdapter(fixture.session).readCurrent()
    expect(stale.state).toBe('unknown')
    expect(stale.userId).toBeUndefined()
    expect(stale.detail).toContain('not a current valid canonical receipt')
    staleRestore.mockRestore()

    const current = await createCanonicalHomeIdentityAdapter(fixture.session).readCurrent()
    expect(current.state).toBe('available')
    expect(current.userId).toBe(USER_A)
    expect(current.identityContract).toBe('wisestay.identity.v1')
    expect(fixture.navigations).toEqual([])
  })

  it('keeps Home non-verified after same-user receipt replacement until the exact current receipt is consumed', async () => {
    let generation = 0
    const fixture = canonicalFixture(async (path) => {
      if (path.endsWith('/readiness')) return response({ contract: CONTRACT, ready: true })
      if (path.endsWith('/bootstrap')) {
        generation++
        return response(authenticatedReceipt(USER_A, Math.floor(Date.now() / 1000) + 3600 + generation))
      }
      throw new Error('Unexpected canonical operation: ' + path)
    })
    const adapters = createCanonicalHomePreflightAdapters(fixture.session)
    adapters.capabilities = { async inspect() { return capabilities } }
    const controller = new HomePreflightController(local, { action: 'scan', localProjectId: local.id }, adapters)

    const firstResult = await controller.refresh()
    expect(firstResult.identity.state).toBe('available')
    const firstReceipt = fixture.session.receipt
    if (!firstReceipt) throw new Error('Expected captured canonical receipt.')

    fixture.session.clear()
    const replacement = await fixture.session.restore()
    if (!replacement) throw new Error('Expected replacement canonical receipt.')
    expect(replacement.user_id).toBe(firstReceipt.user_id)
    expect(replacement).not.toBe(firstReceipt)
    expect(isCurrentReceipt(fixture.session, firstReceipt)).toBe(false)
    expect(isCurrentReceipt(fixture.session, replacement)).toBe(true)

    controller.invalidateAccountContext('Canonical receipt was replaced.')
    const staleRestore = vi.spyOn(fixture.session, 'restore').mockResolvedValueOnce(firstReceipt)
    const staleResult = await controller.refresh()
    expect(staleResult.identity.state).toBe('unknown')
    expect(staleResult.identity.userId).toBeUndefined()
    expect(staleResult.propertyFacts.state).toBe('unavailable')
    expect(staleResult.propertyFacts.contexts).toEqual([])
    expect(staleResult.localProject).toEqual(local)
    staleRestore.mockRestore()

    const currentResult = await controller.refresh()
    expect(currentResult.identity.state).toBe('available')
    expect(currentResult.identity.userId).toBe(USER_A)
    expect(currentResult.identity.identityContract).toBe('wisestay.identity.v1')
    expect(currentResult.propertyFacts.state).toBe('unavailable')
    expect(currentResult.propertyFacts.contexts).toEqual([])
    expect(currentResult.localProject).toEqual(local)
    expect(fixture.navigations).toEqual([])
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
