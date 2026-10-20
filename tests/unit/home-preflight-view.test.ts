import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { RouterView } from 'vue-router'
import { router } from '@/router'
import { db, repository } from '@/data/database'
import { newProject, type Project } from '@/domain/types'
import { HOME_PREFLIGHT_ADAPTERS, createDefaultHomePreflightAdapters } from '@/home/preflight-adapters'
import type {
  CapabilityFact,
  HomeCapabilityFacts,
  HomePreflightAdapters,
  IdentityFact,
  PropertyFactSet,
} from '@/home/preflight'

const Host = defineComponent({ components: { RouterView }, template: '<RouterView />' })
const fact = (state: CapabilityFact['state'], detail: string): CapabilityFact => ({ state, detail })

function capabilityFacts(overrides: Partial<HomeCapabilityFacts> = {}): HomeCapabilityFacts {
  return {
    capture: fact('unavailable', 'Synthetic unsupported capture fixture.'),
    viewing: fact('available', 'Existing viewer fixture is available.'),
    measurement: fact('unknown', 'Measurement qualification is unknown.'),
    offline: fact('unknown', 'Offline readiness is unknown.'),
    cameraPermission: fact('unavailable', 'No camera permission is exposed by this fixture.'),
    storage: fact('pressure', 'Synthetic storage pressure input.'),
    assets: fact('unknown', 'Asset completeness is unknown.'),
    ...overrides,
  }
}

function adapterSet(options: {
  identity?: IdentityFact
  properties?: PropertyFactSet
  capabilities?: HomeCapabilityFacts
} = {}): HomePreflightAdapters {
  const defaultIdentity: IdentityFact = {
    state: 'available',
    userId: 'USER-A',
    identityContract: 'wisestay-user-v1',
    detail: 'Synthetic current account fixture.',
  }
  const defaultProperties: PropertyFactSet = {
    state: 'available',
    contexts: [],
    detail: 'No canonical property selected by the fixture.',
  }
  return {
    identity: { readCurrent: vi.fn(async (): Promise<IdentityFact> => options.identity || defaultIdentity) },
    properties: { readForIntent: vi.fn(async (): Promise<PropertyFactSet> => options.properties || defaultProperties) },
    capabilities: { inspect: vi.fn(async () => options.capabilities || capabilityFacts()) },
  }
}

async function clearWorkspace(): Promise<void> {
  const connection = await db()
  await connection.clear('projects')
  await connection.clear('assets')
  await connection.clear('settings')
}

async function seed(name: string, location = ''): Promise<Project> {
  const project = newProject(name, location)
  await repository.create(project)
  return project
}

let wrapper: VueWrapper | undefined

async function waitForRendered(predicate: () => boolean, label: string): Promise<void> {
  await vi.waitFor(() => {
    expect(predicate(), label).toBe(true)
  }, { timeout: 2000, interval: 10 })
}

async function waitForSettled(page: VueWrapper): Promise<void> {
  await waitForRendered(() => !page.find('.loading-state').exists(), 'Home preflight facts should finish loading')
  await flushPromises()
}

async function mountAt(project: Project, adapters: HomePreflightAdapters, settle = true): Promise<VueWrapper> {
  await router.push(`/projects/${project.id}/preflight`)
  await router.isReady()
  wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      plugins: [router],
      provide: { [HOME_PREFLIGHT_ADAPTERS as symbol]: adapters },
    },
  })
  await waitForRendered(() => wrapper!.text().includes(project.name), `Local project ${project.name} should render`)
  if (settle) await waitForSettled(wrapper)
  return wrapper
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(async () => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  await clearWorkspace()
})

afterEach(async () => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  await clearWorkspace()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Home preflight routed view integration', () => {
  it('renders local identity, intended return and separate capability facts with every real action disabled', async () => {
    const project = await seed('Kitchen example', 'Legacy free-text location')
    const defaults = createDefaultHomePreflightAdapters()
    const adapters: HomePreflightAdapters = {
      identity: defaults.identity,
      properties: defaults.properties,
      capabilities: { inspect: vi.fn(async () => capabilityFacts()) },
    }
    const page = await mountAt(project, adapters)
    const text = page.text()
    expect(text).toContain('Kitchen example')
    expect(text).toContain(project.id)
    expect(text).toContain('Unmatched local project')
    expect(text).toContain('Scan this local project')
    expect(text).toContain('Central identity adapter is not connected in this build.')
    expect(text).toContain('Canonical property adapter is not connected in this build.')

    const rows = page.findAll('.capability-row').map(row => row.text())
    expect(rows.find(row => row.includes('Capture'))).toContain('Unavailable')
    expect(rows.find(row => row.includes('Viewing'))).toContain('Available')
    expect(rows.find(row => row.includes('Measurement'))).toContain('Unknown')
    expect(rows.find(row => row.includes('Offline / local readiness'))).toContain('Unknown')
    expect(rows.find(row => row.includes('Storage'))).toContain('Pressure reported')

    const realActions = ['Sign in / return', 'Select or create property', 'Request camera permission', 'Start capture', 'Measure', 'Upload', 'Migrate legacy project']
    for (const label of realActions) {
      const button = page.findAll('button').find(item => item.text().includes(label))
      expect(button, label).toBeDefined()
      expect(button!.attributes('disabled')).toBeDefined()
    }

    const stored = await repository.get(project.id)
    expect(stored?.name).toBe('Kitchen example')
    expect(stored?.location).toBe('Legacy free-text location')
    expect(stored?.revision).toBe(project.revision)
  })

  it('selects only adapter-supplied property contexts without changing the local project', async () => {
    const project = await seed('Unmatched retained draft')
    const properties: PropertyFactSet = {
      state: 'available',
      detail: 'Synthetic canonical property candidates supplied by the adapter.',
      contexts: [
        { reference: 'PROP-PENDING', name: 'Pending reference', kind: 'real', state: 'pending-review', detail: 'Pending review fixture.' },
        { reference: 'PROP-RESEARCH', name: 'Research context', kind: 'virtual', state: 'virtual-research', detail: 'Virtual research fixture.' },
        { reference: 'PROP-UNAVAILABLE', name: 'Unavailable reference', kind: 'real', state: 'unavailable', detail: 'Unavailable fixture.' },
      ],
    }
    const page = await mountAt(project, adapterSet({ properties }))
    const select = page.get('#canonical-property')
    expect((select.element as HTMLSelectElement).value).toBe('')

    await select.setValue('PROP-PENDING')
    await waitForRendered(() => page.text().includes('PROP-PENDING'), 'Pending property selection should render its exact reference')
    expect(page.text()).toContain('Pending review')
    expect(page.text()).toContain('Pending review fixture.')

    await select.setValue('PROP-RESEARCH')
    await waitForRendered(() => page.text().includes('PROP-RESEARCH'), 'Research property selection should render its exact reference')
    expect(page.text()).toContain('Virtual / research')
    expect(page.text()).toContain('Virtual research fixture.')

    const stored = await repository.get(project.id)
    expect(stored?.revision).toBe(project.revision)
    expect(stored?.name).toBe(project.name)
  })

  it('reloads the same routed component when the local project id changes and preserves the legacy scan route', async () => {
    const first = await seed('First local project')
    const second = await seed('Second local project')
    const page = await mountAt(first, adapterSet())
    expect(page.text()).toContain('First local project')

    await router.push(`/projects/${second.id}/preflight`)
    await waitForRendered(() => page.text().includes('Second local project'), 'Second local project should replace the first route')
    await waitForSettled(page)
    expect(page.text()).toContain('Second local project')
    expect(page.text()).toContain(second.id)
    expect(page.text()).not.toContain('First local project')
    expect(router.currentRoute.value.params.id).toBe(second.id)

    const legacy = router.resolve(`/projects/${second.id}/scan`)
    expect(legacy.matched).toHaveLength(1)
    expect(legacy.meta.title).toBe('Capture')
    expect(legacy.meta.immersive).toBe(true)
    expect(router.resolve(`/projects/${second.id}/preflight`).meta.title).toBe('Home entry preflight')
  })

  it('suppresses a delayed old-route identity callback after switching to another local project', async () => {
    const first = await seed('Slow first project')
    const second = await seed('Current second project')
    const late = deferred<IdentityFact>()
    const identity = {
      readCurrent: vi.fn()
        .mockImplementationOnce(() => late.promise)
        .mockResolvedValueOnce({ state: 'available', userId: 'USER-B', identityContract: 'wisestay-user-v1', detail: 'Current second-account fixture.' }),
    }
    const properties = {
      readForIntent: vi.fn(async (intent: { localProjectId: string }, current: IdentityFact) => ({
        state: 'available' as const,
        contexts: [],
        detail: `Properties for ${intent.localProjectId} / ${current.userId || 'none'}`,
      })),
    }
    const adapters: HomePreflightAdapters = {
      identity,
      properties,
      capabilities: { inspect: vi.fn(async () => capabilityFacts()) },
    }

    const page = await mountAt(first, adapters, false)
    expect(page.text()).toContain('Slow first project')

    await router.push(`/projects/${second.id}/preflight`)
    await waitForRendered(() => page.text().includes('Current second project'), 'Second route should replace the delayed first route')
    await waitForRendered(() => page.text().includes('USER-B'), 'Current second-account fact should render')
    await waitForSettled(page)
    expect(page.text()).toContain('Current second project')
    expect(page.text()).toContain('USER-B')

    late.resolve({ state: 'available', userId: 'USER-OLD', identityContract: 'wisestay-user-v1', detail: 'Late old-route account result.' })
    await flushPromises()

    expect(page.text()).toContain('Current second project')
    expect(page.text()).toContain('USER-B')
    expect(page.text()).not.toContain('USER-OLD')
    expect(page.text()).not.toContain('Late old-route account result.')
  })

  it('clears presented account/property context and ignores a delayed refresh result', async () => {
    const project = await seed('Account-context project')
    const late = deferred<IdentityFact>()
    const identity = {
      readCurrent: vi.fn()
        .mockResolvedValueOnce({ state: 'available', userId: 'USER-A', identityContract: 'wisestay-user-v1', detail: 'Initial current account.' })
        .mockImplementationOnce(() => late.promise),
    }
    const properties = {
      readForIntent: vi.fn(async () => ({
        state: 'available' as const,
        contexts: [{ reference: 'PROP-A', name: 'Property A', kind: 'real' as const, state: 'ready' as const, detail: 'Ready fixture.' }],
        detail: 'Current property facts.',
      })),
    }
    const adapters: HomePreflightAdapters = {
      identity,
      properties,
      capabilities: { inspect: vi.fn(async () => capabilityFacts()) },
    }
    const page = await mountAt(project, adapters)
    expect(page.text()).toContain('USER-A')

    const reread = page.findAll('button').find(item => item.text().includes('Re-read injected facts'))!
    await reread.trigger('click')
    await waitForRendered(() => page.find('.loading-state').exists(), 'Delayed refresh should enter loading state')
    const clear = page.findAll('button').find(item => item.text().includes('Clear external context presentation'))!
    await clear.trigger('click')
    expect(page.text()).toContain('Account context changed')
    expect(page.text()).not.toContain('USER-A')

    late.resolve({ state: 'available', userId: 'USER-LATE', identityContract: 'wisestay-user-v1', detail: 'Late account callback.' })
    await flushPromises()

    expect(page.text()).not.toContain('USER-LATE')
    expect(page.text()).not.toContain('Late account callback.')
    expect(page.text()).toContain('Account context changed')
    expect(properties.readForIntent).toHaveBeenCalledTimes(1)
  })

  it('announces one accessible preflight summary whose text changes on the account-clear path (HSA-02.3, HSA-08.1)', async () => {
    const project = await seed('Summary project')
    const properties: PropertyFactSet = {
      state: 'available',
      contexts: [{ reference: 'PROP-A', name: 'Property A', kind: 'real', state: 'ready', detail: 'Ready fixture.' }],
      detail: 'Current property facts.',
    }
    const page = await mountAt(project, adapterSet({ properties, capabilities: capabilityFacts({ cameraPermission: fact('unknown', 'Not requested.') }) }))
    const summary = page.get('.preflight-summary')
    expect(summary.attributes('data-status')).toBe('unsupported')
    // A-R4: the live region holds only headline plus explanation; the full text alternative is not live.
    const region = page.get('.preflight-live')
    expect(region.attributes('role')).toBe('status')
    expect(region.attributes('aria-live')).toBe('polite')
    const before = region.text()
    expect(before).toContain('Capture is not supported in this runtime.')
    expect(before).toContain('Real actions stay disabled.')
    expect(before).not.toContain('Capture: Unavailable.')
    expect(before).not.toContain('USER-A')
    const alternative = page.get('.preflight-text-alternative')
    expect(alternative.text()).toContain('Capture: Unavailable.')
    expect(alternative.attributes('aria-live')).toBeUndefined()
    expect(alternative.element.closest('[aria-live]')).toBeNull()

    const clear = page.findAll('button').find(item => item.text().includes('Clear external context presentation'))!
    await clear.trigger('click')
    await waitForRendered(() => page.get('.preflight-summary').attributes('data-status') === 'conflict', 'Summary should report the account change')
    const after = page.get('.preflight-live').text()
    expect(after).not.toBe(before)
    expect(after).toContain('The account changed.')
    expect(page.get('.preflight-text-alternative').text()).toContain('Central identity: Unavailable.')
    expect(page.findAll('[role="status"][aria-live="polite"]')).toHaveLength(1)
  })

  it('HSA-02.1 stale facts after context change render stale', async () => {
    const project = await seed('Stale context project')
    const properties: PropertyFactSet = {
      state: 'available',
      contexts: [{ reference: 'PROP-A', name: 'Property A', kind: 'real', state: 'ready', detail: 'Ready fixture.' }],
      detail: 'Current property facts.',
    }
    const adapters = adapterSet({ properties, capabilities: capabilityFacts({ capture: fact('unknown', 'Not checked.'), cameraPermission: fact('unknown', 'Not requested.') }) })
    const page = await mountAt(project, adapters)
    expect(page.get('.preflight-summary').attributes('data-status')).toBe('ready-unqualified')

    // A-R1: the return context changes after the shown facts were read.
    await router.push({ path: `/projects/${project.id}/preflight`, query: { property: 'PROP-A' } })
    await waitForRendered(() => page.get('.preflight-summary').attributes('data-status') === 'stale', 'Changed return context should render stale')
    expect(page.get('.preflight-live').text()).toContain('These facts are out of date.')
    expect(page.get('.preflight-live').text()).toContain('Re-read facts before relying on them.')

    const reread = page.findAll('button').find(item => item.text().includes('Re-read injected facts'))!
    await reread.trigger('click')
    await waitForSettled(page)
    await waitForRendered(() => page.get('.preflight-summary').attributes('data-status') === 'ready-unqualified', 'Re-read facts should no longer be stale')
    expect(page.text()).toContain('PROP-A')
  })

  it('HSA-02.1 loading renders loading', async () => {
    const project = await seed('Loading project')
    const late = deferred<IdentityFact>()
    const adapters: HomePreflightAdapters = {
      identity: { readCurrent: vi.fn(() => late.promise) },
      properties: { readForIntent: vi.fn(async () => ({ state: 'available' as const, contexts: [], detail: 'No properties.' })) },
      capabilities: { inspect: vi.fn(async () => capabilityFacts()) },
    }
    const page = await mountAt(project, adapters, false)
    // A-R1: the controller's loading snapshot is committed, so the summary renders loading.
    await waitForRendered(() => page.find('.preflight-summary').exists() && page.get('.preflight-summary').attributes('data-status') === 'loading', 'Loading snapshot should render')
    expect(page.get('.preflight-live').text()).toContain('Reading preflight facts.')
    late.resolve({ state: 'available', userId: 'USER-A', identityContract: 'wisestay-user-v1', detail: 'Synthetic account.' })
    await waitForSettled(page)
    expect(page.get('.preflight-summary').attributes('data-status')).toBe('denied')
  })
})
