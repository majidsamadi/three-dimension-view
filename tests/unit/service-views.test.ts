import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { RouterView } from 'vue-router'
import { router } from '@/router'
import { db, repository } from '@/data/database'
import { newProject } from '@/domain/types'
import { SERVICE_PUBLISH_COMPOSITION, SERVICE_UPLOAD_COMPOSITION, createDefaultPublishComposition, type ServicePublishComposition, type ServiceUploadComposition } from '@/service/compositions'
import { FakeHomeScannerApi } from '@/service/home-scanner-fake'
import { ServiceProblem, type SceneDetail } from '@/service/home-scanner-api'
import { FIXTURE_PROJECT_ID, createFixtureUploadComposition } from '@/service/review-fixtures'
import { SERVICE_VIEWER_FACTORY, RENDERER_LABELS } from '@/service/viewer-port'
import { createFakeViewer } from './support/fake-viewer'

// State coverage for the service-mode views (HSA-05, HSA-06). Status: component-tested (synthetic data only).
const Host = defineComponent({ components: { RouterView }, template: '<RouterView />' })
let wrapper: VueWrapper | undefined
const headlines = new Map<string, string>()

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

async function mountAt(path: string, provide: Record<symbol, unknown>): Promise<VueWrapper> {
  await router.push(path)
  await router.isReady()
  wrapper = mount(Host, { attachTo: document.body, global: { plugins: [router], provide } })
  await flushPromises()
  return wrapper
}

const statusRegion = (page: VueWrapper) => page.get('[role="status"]')
const status = (page: VueWrapper) => page.get('.service-status').attributes('data-status')

async function waitForStatus(page: VueWrapper, expected: string): Promise<void> {
  await vi.waitFor(() => { expect(status(page)).toBe(expected) }, { timeout: 2000, interval: 5 })
  await flushPromises()
}

function button(page: VueWrapper, name: string) {
  const found = page.findAll('button').find(item => item.text() === name)
  expect(found, name).toBeDefined()
  return found!
}

/** Records the headline for a state, checks it is the only live region and that actions are named buttons. */
function record(page: VueWrapper, state: string): void {
  expect(page.findAll('[role="status"]'), state).toHaveLength(1)
  const region = statusRegion(page)
  expect(region.attributes('aria-live')).toBe('polite')
  // Headline text only: one sentence group, no lists or nested controls.
  expect(region.element.children).toHaveLength(0)
  const text = region.text()
  expect(text.length, state).toBeGreaterThan(0)
  headlines.set(state, text)
  for (const control of page.findAll('button')) {
    expect(control.attributes('type'), control.text()).toBe('button')
    expect(control.text().length).toBeGreaterThan(0)
  }
  expect(page.findAll('[role="button"], a[href="#"], div[onclick]')).toHaveLength(0)
  for (const control of page.findAll('button[disabled][aria-describedby]')) {
    expect(page.find(`#${control.attributes('aria-describedby')}`).text()).toMatch(/unavailable:/)
  }
  for (const field of page.findAll('select, input')) {
    expect(page.find(`label[for="${field.attributes('id')}"]`).exists(), field.attributes('id')).toBe(true)
  }
}

function uploadComposition(fake = new FakeHomeScannerApi()): ServiceUploadComposition & { fake: FakeHomeScannerApi } {
  return createFixtureUploadComposition(fake)
}

async function mountUpload(composition: ServiceUploadComposition): Promise<VueWrapper> {
  return mountAt(`/service/projects/${FIXTURE_PROJECT_ID}/upload`, { [SERVICE_UPLOAD_COMPOSITION as symbol]: composition })
}

async function consentAndStart(page: VueWrapper): Promise<void> {
  await page.get('#service-consent').setValue(true)
  await button(page, 'Start upload').trigger('click')
  await flushPromises()
}

function publishComposition(fake: FakeHomeScannerApi, sceneId?: string): ServicePublishComposition {
  return { mode: 'synthetic-fixture', api: fake, fixtureSceneId: sceneId }
}

async function mountPublish(composition: ServicePublishComposition, sceneId: string): Promise<VueWrapper> {
  return mountAt(`/service/scenes/${sceneId}/publish`, {
    [SERVICE_PUBLISH_COMPOSITION as symbol]: composition,
    [SERVICE_VIEWER_FACTORY as symbol]: async () => createFakeViewer(),
  })
}

beforeEach(async () => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  const connection = await db()
  await connection.clear('projects')
  await connection.clear('pending-service-uploads')
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ServiceUploadView states', () => {
  it('loading, then ready, with the disclosure, the HSA-05.3 note and the fixture label', async () => {
    const composition = uploadComposition()
    const gate = deferred<void>()
    const read = composition.readProject
    composition.readProject = async id => { await gate.promise; return read(id) }
    const page = await mountUpload(composition)
    expect(status(page)).toBe('loading')
    record(page, 'upload:loading')
    gate.resolve()
    await waitForStatus(page, 'ready')
    record(page, 'upload:ready')
    expect(page.text()).toContain('Prototype / synthetic / not connected.')
    expect(page.text()).toContain('Cloud processing is not offered.')
    expect(page.text()).toContain('Device capture is not qualified.')
    expect(button(page, 'Start upload').attributes('disabled')).toBeDefined()
    expect(page.text()).toContain('Start upload is unavailable: Confirm that the processed model may leave this device.')
  })

  it('empty: a project with no scanned sections', async () => {
    const composition = uploadComposition()
    composition.readProject = async () => ({ id: FIXTURE_PROJECT_ID, name: 'Empty synthetic project', sceneCount: 0, photoCount: 0 })
    const page = await mountUpload(composition)
    await waitForStatus(page, 'empty')
    record(page, 'upload:empty')
    expect(page.text()).toContain('There is no scanned section to upload.')
  })

  it('offline/disconnected (503) by default and with the offline scenario', async () => {
    // Default composition: disconnected transport, no property service, so Start stays disabled with a reason.
    const project = newProject('Local legacy project')
    await repository.create(project)
    const page = await mountAt(`/service/projects/${project.id}/upload`, {})
    await waitForStatus(page, 'empty')
    expect(page.text()).toContain('Not connected.')
    expect(page.text()).toContain('There is no scanned section to upload.')
    wrapper!.unmount()

    const composition = uploadComposition()
    composition.fake.scenario.offline = true
    const offline = await mountUpload(composition)
    await waitForStatus(offline, 'ready')
    await consentAndStart(offline)
    await waitForStatus(offline, 'offline')
    record(offline, 'upload:offline')
    expect(statusRegion(offline).text()).toContain('Nothing was uploaded.')
  })

  it('denied (403) and conflict (409)', async () => {
    const denied = uploadComposition()
    vi.spyOn(denied.fake, 'createCapture').mockRejectedValue(new ServiceProblem(403, 'action_denied'))
    let page = await mountUpload(denied)
    await waitForStatus(page, 'ready')
    await consentAndStart(page)
    await waitForStatus(page, 'denied')
    record(page, 'upload:denied')
    wrapper!.unmount()

    const conflict = uploadComposition()
    vi.spyOn(conflict.fake, 'admitUpload').mockRejectedValue(new ServiceProblem(409, 'version_conflict'))
    page = await mountUpload(conflict)
    await waitForStatus(page, 'ready')
    await consentAndStart(page)
    await waitForStatus(page, 'conflict')
    record(page, 'upload:conflict')
  })

  it('expired (410), quarantined and validated', async () => {
    const expired = uploadComposition()
    expired.fake.scenario.expireUpload = true
    let page = await mountUpload(expired)
    await waitForStatus(page, 'ready')
    await consentAndStart(page)
    await waitForStatus(page, 'expired')
    record(page, 'upload:expired')
    wrapper!.unmount()

    const quarantined = uploadComposition()
    const prepare = quarantined.prepare
    quarantined.prepare = async id => {
      const prepared = await prepare(id)
      const bytes = new TextEncoder().encode('synthetic non-GLB bytes')
      const { descriptorFor } = await import('@/service/compositions')
      return { ...prepared, components: [await descriptorFor('main', bytes)] }
    }
    page = await mountUpload(quarantined)
    await waitForStatus(page, 'ready')
    await consentAndStart(page)
    await waitForStatus(page, 'quarantined')
    record(page, 'upload:quarantined')
    expect(page.text()).toContain('glb_bad_magic')
    wrapper!.unmount()

    page = await mountUpload(uploadComposition())
    await waitForStatus(page, 'ready')
    await consentAndStart(page)
    await waitForStatus(page, 'validated')
    record(page, 'upload:validated')
  })

  it('cancelled after a pause keeps the local project', async () => {
    const composition = uploadComposition()
    // Two parts, so a pause requested during the first PUT takes effect before the second.
    const prepare = composition.prepare
    composition.prepare = async id => {
      const prepared = await prepare(id)
      const { descriptorFor } = await import('@/service/compositions')
      const { buildSyntheticGlb } = await import('@/service/review-fixtures')
      return { ...prepared, components: [...prepared.components, await descriptorFor('second', buildSyntheticGlb('second-part'))] }
    }
    const gate = deferred<void>()
    const inner = composition.putComponent
    composition.putComponent = async (url, headers, bytes) => { await gate.promise; return inner(url, headers, bytes) }
    const page = await mountUpload(composition)
    await waitForStatus(page, 'ready')
    await consentAndStart(page)
    await waitForStatus(page, 'transferring')
    record(page, 'upload:transferring')
    await button(page, 'Pause upload').trigger('click')
    gate.resolve()
    await waitForStatus(page, 'paused')
    record(page, 'upload:paused')
    await button(page, 'Cancel upload').trigger('click')
    await waitForStatus(page, 'cancelled')
    record(page, 'upload:cancelled')
    expect(statusRegion(page).text()).toContain('Your local project is unchanged.')
    expect(composition.fake.calls).not.toContain('finalizeUpload')
  })
})

describe('ServicePublishView states', () => {
  it('offline/disconnected (503) with the default composition', async () => {
    const page = await mountAt('/service/scenes/scn_01HZYSYNTH0000000000000001/publish', {})
    await waitForStatus(page, 'offline')
    record(page, 'publish:offline')
    expect(page.text()).toContain('Not connected.')
    expect(createDefaultPublishComposition().mode).toBe('disconnected')
  })

  it('loading, ready, published only after confirmation, then withdrawn', async () => {
    const fake = new FakeHomeScannerApi()
    const sceneId = fake.seedScene({ versions: [{ review_state: 'approved' }] })
    const gate = deferred<void>()
    const getScene = FakeHomeScannerApi.prototype.getScene.bind(fake)
    vi.spyOn(fake, 'getScene').mockImplementationOnce(async id => { await gate.promise; return getScene(id) })
    const page = await mountPublish(publishComposition(fake), sceneId)
    expect(status(page)).toBe('loading')
    record(page, 'publish:loading')
    gate.resolve()
    await waitForStatus(page, 'ready')
    record(page, 'publish:ready')
    expect(page.text()).toContain('Version 1 of scene')
    expect(page.text()).toContain('Explicit grantees only')
    expect(page.text()).toContain('Raw capture (camera, depth and motion data)')
    expect(page.text()).toContain(`3D preview: ${RENDERER_LABELS['webgl2-compatibility']}`)

    const publishGate = deferred<void>()
    const publish = FakeHomeScannerApi.prototype.publish.bind(fake)
    vi.spyOn(fake, 'publish').mockImplementationOnce(async (...args) => { await publishGate.promise; return publish(...args) })
    await button(page, 'Publish this version').trigger('click')
    await waitForStatus(page, 'publishing')
    record(page, 'publish:publishing')
    expect(page.text()).not.toContain('is published to explicit grantees')
    publishGate.resolve()
    await waitForStatus(page, 'published')
    record(page, 'publish:published')

    expect(button(page, 'Withdraw publication').attributes('disabled')).toBeDefined()
    expect(page.text()).toContain('Blocks new viewers now; already-issued view links expire within 5 minutes.')
    await page.get('#withdraw-reason').setValue('Synthetic withdrawal')
    await button(page, 'Withdraw publication').trigger('click')
    await waitForStatus(page, 'withdrawn')
    record(page, 'publish:withdrawn')
  })

  it('denied (403), conflict (409) and not found (404)', async () => {
    const fake = new FakeHomeScannerApi()
    const sceneId = fake.seedScene({ versions: [{ review_state: 'draft' }] })
    let page = await mountPublish(publishComposition(fake), sceneId)
    await waitForStatus(page, 'ready')
    fake.scenario.denied = true
    await button(page, 'Approve this version').trigger('click')
    await waitForStatus(page, 'denied')
    record(page, 'publish:denied')
    wrapper!.unmount()

    const conflicting = new FakeHomeScannerApi({ scenario: { conflictOnPublish: true } })
    const approved = conflicting.seedScene({ versions: [{ review_state: 'approved' }] })
    page = await mountPublish(publishComposition(conflicting), approved)
    await waitForStatus(page, 'ready')
    await button(page, 'Publish this version').trigger('click')
    await waitForStatus(page, 'conflict')
    record(page, 'publish:conflict')
    expect(button(page, 'Publish this version').attributes('disabled')).toBeDefined()
    expect(page.text()).toContain('Publish is unavailable: Re-read the scene first')
    wrapper!.unmount()

    page = await mountPublish(publishComposition(new FakeHomeScannerApi()), 'scn_01HZYSYNTH9999999999999999')
    await waitForStatus(page, 'not-found')
    record(page, 'publish:not-found')
  })

  it('empty: no validated version', async () => {
    const fake = new FakeHomeScannerApi()
    const sceneId = fake.seedScene({ versions: [{ state: 'quarantined' }] })
    const page = await mountPublish(publishComposition(fake), sceneId)
    await waitForStatus(page, 'empty')
    record(page, 'publish:empty')
  })

  it('stale: an older response arriving after a newer one is ignored', async () => {
    const fake = new FakeHomeScannerApi()
    const sceneId = fake.seedScene({ versions: [{ review_state: 'approved' }] })
    const page = await mountPublish(publishComposition(fake), sceneId)
    await waitForStatus(page, 'ready')
    const older = await fake.getScene(sceneId)
    const first = deferred<SceneDetail>()
    const second = deferred<SceneDetail>()
    vi.spyOn(fake, 'getScene').mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
    await button(page, 'Re-read scene').trigger('click')
    await waitForStatus(page, 'stale')
    record(page, 'publish:stale')
    await button(page, 'Re-read scene').trigger('click')
    // The service published in the meantime; the newer read sees it.
    const projection = await fake.getAudienceProjection(sceneId, '1')
    await fake.publish(sceneId, { version: '1', projection_id: projection.projection_id, expected_version: older.record_version })
    second.resolve(await FakeHomeScannerApi.prototype.getScene.call(fake, sceneId))
    await waitForStatus(page, 'published')
    first.resolve(older)
    await flushPromises()
    expect(status(page)).toBe('published')
  })

  it('every state has distinct status text', () => {
    const expected = [
      'upload:loading', 'upload:ready', 'upload:empty', 'upload:offline', 'upload:denied', 'upload:conflict', 'upload:expired',
      'upload:quarantined', 'upload:validated', 'upload:transferring', 'upload:paused', 'upload:cancelled',
      'publish:offline', 'publish:loading', 'publish:ready', 'publish:publishing', 'publish:published', 'publish:withdrawn',
      'publish:denied', 'publish:conflict', 'publish:not-found', 'publish:empty', 'publish:stale',
    ]
    expect([...headlines.keys()].sort()).toEqual([...expected].sort())
    expect(new Set(headlines.values()).size).toBe(headlines.size)
  })
})
