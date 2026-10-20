import { describe, expect, it } from 'vitest'
import {
  HomePreflightController,
  type HomeCapabilityFacts,
  type HomePreflightAdapters,
  type IdentityFact,
  type PropertyFactSet,
} from '@/home/preflight'

const local = { id: '11111111-1111-4111-8111-111111111111', revision: 7, name: 'Kitchen example', location: 'Local note only' }
const intent = { action: 'scan' as const, localProjectId: local.id }
const capabilities = (overrides: Partial<HomeCapabilityFacts> = {}): HomeCapabilityFacts => ({
  capture: { state: 'unknown', detail: 'capture unknown' },
  viewing: { state: 'available', detail: 'viewer present' },
  measurement: { state: 'unqualified', detail: 'measurement UI only' },
  offline: { state: 'unknown', detail: 'offline not qualified' },
  cameraPermission: { state: 'unknown', detail: 'not requested' },
  storage: { state: 'unknown', detail: 'no threshold' },
  assets: { state: 'unknown', detail: 'not checked' },
  ...overrides,
})
const identity = (userId = 'user-a'): IdentityFact => ({ state: 'available', userId, identityContract: 'fixture', detail: 'synthetic test fact' })
const properties = (state: PropertyFactSet['state'] = 'available'): PropertyFactSet => ({
  state,
  detail: state === 'available' ? 'fixture property facts' : 'unavailable',
  contexts: state === 'available' ? [
    { reference: 'prop-pending', name: 'Pending reference', kind: 'real', state: 'pending-review', detail: 'pending review' },
    { reference: 'prop-research', name: 'Research reference', kind: 'virtual', state: 'virtual-research', detail: 'virtual research context' },
    { reference: 'prop-ready', name: 'Ready reference', kind: 'real', state: 'ready', detail: 'ready fixture fact' },
  ] : [],
})
const adapters = (overrides: Partial<HomePreflightAdapters> = {}): HomePreflightAdapters => ({
  identity: { async readCurrent() { return identity() } },
  properties: { async readForIntent() { return properties() } },
  capabilities: { async inspect() { return capabilities() } },
  ...overrides,
})

describe('home entry/preflight controller', () => {
  it('preserves the unmatched local project and scan intent without manufacturing a property', async () => {
    const controller = new HomePreflightController(local, intent, adapters({ properties: { async readForIntent() { return { state: 'unavailable', contexts: [], detail: 'no canonical facts' } } } }))
    const result = await controller.refresh()
    expect(result.localProject).toEqual(local)
    expect(result.intent).toEqual(intent)
    expect(result.selectedPropertyRef).toBeUndefined()
    expect(result.propertyFacts.contexts).toEqual([])
  })

  it('keeps pending, virtual/research and unavailable property states distinct', async () => {
    const controller = new HomePreflightController(local, intent, adapters())
    const result = await controller.refresh()
    expect(result.propertyFacts.contexts.map(item => item.state)).toEqual(['pending-review', 'virtual-research', 'ready'])
    expect(controller.selectProperty('prop-pending').selectedPropertyRef).toBe('prop-pending')
    expect(controller.selectProperty('prop-research').selectedPropertyRef).toBe('prop-research')
  })

  it('does not promote unsupported camera, unknown measurement or storage pressure into other capability facts', async () => {
    const injected = capabilities({
      capture: { state: 'unavailable', detail: 'camera/device unsupported fixture' },
      measurement: { state: 'unknown', detail: 'measurement status unknown' },
      storage: { state: 'pressure', detail: 'storage-pressure fixture input' },
      viewing: { state: 'available', detail: 'viewer remains independent' },
    })
    const controller = new HomePreflightController(local, intent, adapters({ capabilities: { async inspect() { return injected } } }))
    const result = await controller.refresh()
    expect(result.capabilities.capture.state).toBe('unavailable')
    expect(result.capabilities.measurement.state).toBe('unknown')
    expect(result.capabilities.storage.state).toBe('pressure')
    expect(result.capabilities.viewing.state).toBe('available')
    expect(result.capabilities.offline.state).toBe('unknown')
  })

  it('keeps property switching separate from local project identity', async () => {
    const controller = new HomePreflightController(local, intent, adapters())
    await controller.refresh()
    const first = controller.selectProperty('prop-ready')
    const second = controller.selectProperty('prop-research')
    expect(first.localProject.id).toBe(local.id)
    expect(second.localProject.id).toBe(local.id)
    expect(second.selectedPropertyRef).toBe('prop-research')
  })

  it('clears external identity/property presentation on account change but preserves local project and intent', async () => {
    const controller = new HomePreflightController(local, intent, adapters())
    await controller.refresh(); controller.selectProperty('prop-ready')
    const result = controller.invalidateAccountContext()
    expect(result.identity.state).toBe('unavailable')
    expect(result.selectedPropertyRef).toBeUndefined()
    expect(result.propertyFacts.contexts).toEqual([])
    expect(result.localProject).toEqual(local)
    expect(result.intent).toEqual(intent)
  })

  it('ignores delayed external facts after the account context is invalidated', async () => {
    let resolveIdentity!: (value: IdentityFact) => void
    const delayed = new Promise<IdentityFact>(resolve => { resolveIdentity = resolve })
    const controller = new HomePreflightController(local, intent, adapters({ identity: { async readCurrent() { return delayed } } }))
    const pending = controller.refresh()
    const invalidated = controller.invalidateAccountContext('account switched')
    resolveIdentity(identity('old-user'))
    await pending
    const final = controller.snapshot()
    expect(final.contextRevision).toBe(invalidated.contextRevision)
    expect(final.identity.state).toBe('unavailable')
    expect(final.identity.userId).toBeUndefined()
    expect(final.localProject.id).toBe(local.id)
  })

  it('ignores delayed property results after the intended return context changes', async () => {
    let resolveProperties!: (value: PropertyFactSet) => void
    const delayed = new Promise<PropertyFactSet>(resolve => { resolveProperties = resolve })
    const controller = new HomePreflightController(local, intent, adapters({ properties: { async readForIntent() { return delayed } } }))
    const pending = controller.refresh()
    await Promise.resolve()
    const changed = controller.replaceIntent({ action: 'scan', localProjectId: local.id, canonicalPropertyRef: 'prop-new' })
    resolveProperties(properties())
    await pending
    const final = controller.snapshot()
    expect(final.contextRevision).toBe(changed.contextRevision)
    expect(final.intent.canonicalPropertyRef).toBe('prop-new')
    expect(final.propertyFacts.contexts).toEqual([])
  })
})
