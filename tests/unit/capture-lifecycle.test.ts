import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import ScanView from '@/views/ScanView.vue'

const harness = vi.hoisted(() => ({
 guard: undefined as undefined | (() => Promise<boolean>),
 resolveStart: undefined as undefined | (() => void),
 options: undefined as undefined | { sessionId: string; projectId: string },
 native: true, start: vi.fn(), stop: vi.fn(), remove: vi.fn(), addListener: vi.fn(),
 putDraft: vi.fn(), recoveries: vi.fn(), readResult: vi.fn(),
 browserStart: vi.fn(), browserStop: vi.fn(), browserSnapshot: vi.fn(),
}))
const projectId = '11111111-1111-4111-8111-111111111111'
vi.mock('vue-router', () => ({
 useRoute: () => ({ params: { id: '11111111-1111-4111-8111-111111111111' } }),
 useRouter: () => ({ push: vi.fn() }),
 onBeforeRouteLeave: (guard: () => Promise<boolean>) => { harness.guard = guard },
}))
vi.mock('@/data/database', () => ({ repository: { get: vi.fn(async () => ({
 id: '11111111-1111-4111-8111-111111111111', name: 'Lifecycle test', scenes: [], photos: [], revision: 1,
})) } }))
vi.mock('@/data/drafts', () => ({ drafts: { list: vi.fn(async () => []), put: harness.putDraft, remove: vi.fn(async () => undefined) } }))
vi.mock('@/services/capabilities', () => ({ getCapabilities: vi.fn(async () => ({
 platform: harness.native ? 'ios' : 'web', xr: !harness.native,
 native: harness.native ? { available: true, support: 'supported', source: 'arkit-mesh', reason: 'Unit-test bridge only' } : undefined,
})) }))
vi.mock('@/scanner/native', () => ({
 nativeScannerAvailable: () => harness.native,
 readNativeResult: harness.readResult,
 PhoneScanner: { getRecoveries: harness.recoveries, addListener: harness.addListener, start: harness.start, stop: harness.stop },
}))
vi.mock('@/scanner/webxr', () => ({ BrowserDepthScanner: class {
 start() { return harness.browserStart() }
 stop() { return harness.browserStop() }
 snapshot() { return harness.browserSnapshot() }
} }))
const geometry = () => ({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), colors: new Float32Array(), indices: new Uint32Array([0, 1, 2]) })
const result = (sessionId = harness.options?.sessionId || '22222222-2222-4222-8222-222222222222') => ({
 sessionId, projectId, source: 'arkit-mesh', vertices: 3, indices: 3, elapsedMs: 1000,
 capturedAt: '2026-09-23T10:00:00Z', warnings: [],
})
let wrapper: VueWrapper | undefined
beforeEach(() => {
 harness.native = true; harness.options = undefined; harness.resolveStart = undefined
 for (const value of Object.values(harness)) if (vi.isMockFunction(value)) value.mockReset()
 harness.remove.mockResolvedValue(undefined)
 harness.addListener.mockResolvedValue({ remove: harness.remove })
 harness.start.mockImplementation((options: { sessionId: string; projectId: string }) => {
  harness.options = options
  return new Promise<void>(resolve => { harness.resolveStart = resolve })
 })
 harness.stop.mockImplementation(async () => result())
 harness.readResult.mockImplementation(async (raw: ReturnType<typeof result>) => ({ result: raw, geometry: geometry() }))
 harness.recoveries.mockResolvedValue({ results: [] })
 harness.putDraft.mockResolvedValue(undefined)
 harness.browserStart.mockResolvedValue(undefined); harness.browserStop.mockResolvedValue(undefined)
 harness.browserSnapshot.mockImplementation(geometry)
})
afterEach(async () => {
 wrapper?.unmount(); wrapper = undefined; await flushPromises(); vi.restoreAllMocks()
 document.body.innerHTML = ''; document.body.classList.remove('native-capture'); document.documentElement.classList.remove('native-capture')
})
async function setup(): Promise<void> {
 wrapper = mount(ScanView, { attachTo: document.body, global: { stubs: { RouterLink: true, SceneViewer: true, AppIcon: true } } })
 await flushPromises()
}
async function start(): Promise<void> {
 await setup(); await wrapper!.get('.consent-check input').setValue(true)
 await wrapper!.findAll('button').find(b => b.text().includes('Start 3D capture'))!.trigger('click')
 await flushPromises()
}
async function completeNativeStart(): Promise<void> { harness.resolveStart!(); await flushPromises() }
function unmount(): void { wrapper!.unmount(); wrapper = undefined }
function unloadPrevented(): boolean {
 const event = new Event('beforeunload', { cancelable: true })
 window.dispatchEvent(event); return event.defaultPrevented
}

describe('capture lifecycle (simulated bridges, not phone qualification)', () => {
 it('blocks navigation during camera startup and closes capture on unexpected unmount', async () => {
  await start()
  expect(wrapper!.classes()).toContain('live')
  expect(await harness.guard!()).toBe(false)
  expect(harness.stop).not.toHaveBeenCalled()
  await completeNativeStart(); unmount(); await flushPromises()
  expect(harness.stop).toHaveBeenCalledTimes(1)
  expect(harness.remove).toHaveBeenCalledTimes(1)
  expect(document.body.classList.contains('native-capture')).toBe(false)
 })
 it('stops a camera whose permission request resolves after the view unmounts', async () => {
  await start(); unmount(); await flushPromises()
  expect(harness.stop).not.toHaveBeenCalled()
  await completeNativeStart()
  expect(harness.stop).toHaveBeenCalledTimes(1)
  expect(harness.remove).toHaveBeenCalledTimes(1)
  expect(document.body.classList.contains('native-capture')).toBe(false)
  expect(document.documentElement.classList.contains('native-capture')).toBe(false)
 })
 it('does not open a camera when listener registration completes after unmount', async () => {
  let resolveListener!: (value: { remove: typeof harness.remove }) => void
  harness.addListener.mockImplementation(() => new Promise(resolve => { resolveListener = resolve }))
  await start(); unmount(); resolveListener({ remove: harness.remove }); await flushPromises()
  expect(harness.start).not.toHaveBeenCalled()
  expect(harness.remove).toHaveBeenCalledTimes(1)
  expect(document.body.classList.contains('native-capture')).toBe(false)
 })
 it('clears native overlays even if listener removal rejects', async () => {
  harness.remove.mockRejectedValue(new Error('Native listener already removed'))
  await start(); await completeNativeStart(); unmount(); await flushPromises()
  expect(harness.stop).toHaveBeenCalledTimes(1)
  expect(document.body.classList.contains('native-capture')).toBe(false)
  expect(document.documentElement.classList.contains('native-capture')).toBe(false)
 })
 it('keeps the view open when native finalization fails instead of promising recovery', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  harness.stop.mockRejectedValue(new Error('Native finalization failed'))
  await start(); await completeNativeStart()
  expect(await harness.guard!()).toBe(false)
  expect(wrapper!.text()).toContain('Native finalization failed')
  expect(harness.putDraft).not.toHaveBeenCalled()
 })
 it('does not navigate away after a browser recovery write fails', async () => {
  harness.native = false; harness.putDraft.mockRejectedValue(new Error('Storage full'))
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  await start()
  expect(await harness.guard!()).toBe(false)
  await flushPromises()
  expect(wrapper!.find('.capture-review').exists()).toBe(true)
  expect(wrapper!.text()).toContain('No recovery copy could be saved')
  expect(unloadPrevented()).toBe(true)
  confirm.mockReturnValueOnce(false)
  expect(await harness.guard!()).toBe(false)
  expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('permanently lose'))
  confirm.mockReturnValueOnce(true)
  expect(await harness.guard!()).toBe(true)
 })
 it('allows leaving a browser scan only after its final recovery write succeeds', async () => {
  harness.native = false; vi.spyOn(window, 'confirm').mockReturnValue(true)
  await start()
  expect(await harness.guard!()).toBe(true)
  expect(harness.putDraft).toHaveBeenCalledTimes(1)
  expect(harness.putDraft.mock.calls[0][0].projectId).toBe(projectId)
  expect(unloadPrevented()).toBe(false)
 })
 it('retains usable native recovery when the browser copy cannot be written', async () => {
  harness.recoveries.mockResolvedValue({ results: [result()] })
  harness.putDraft.mockRejectedValue(new Error('Storage full'))
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  await setup(); await wrapper!.findAll('button').find(b => b.text() === 'Recover')!.trigger('click'); await flushPromises()
  expect(wrapper!.find('.capture-review').exists()).toBe(true)
  expect(wrapper!.text()).toContain('native recovery copy remains on this phone')
  expect(await harness.guard!()).toBe(true)
  expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('in recovery storage'))
 })
 it('guards reload during capture and removes the guard when the view unmounts', async () => {
  await start(); expect(unloadPrevented()).toBe(true)
  await completeNativeStart(); expect(unloadPrevented()).toBe(true)
  unmount(); await flushPromises(); expect(unloadPrevented()).toBe(false)
 })
})
