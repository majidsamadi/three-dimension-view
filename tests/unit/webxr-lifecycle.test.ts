import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { BrowserDepthScanner } from '@/scanner/webxr'

const harness = vi.hoisted(() => ({ setSession: vi.fn(), loop: vi.fn(), dispose: vi.fn(), constructed: vi.fn() }))
vi.mock('three', async importOriginal => ({
 ...await importOriginal<typeof import('three')>(),
 WebGLRenderer: class {
  constructor() { harness.constructed() }
  xr = { enabled: false, setReferenceSpaceType: vi.fn(), setSession: harness.setSession }
  setSize = vi.fn()
  setAnimationLoop = harness.loop
  dispose = harness.dispose
 },
}))
function deferred<T>() {
 let resolve!: (value: T) => void
 const promise = new Promise<T>(r => { resolve = r })
 return { promise, resolve }
}
let originalXR: PropertyDescriptor | undefined
beforeEach(() => {
 originalXR = Object.getOwnPropertyDescriptor(navigator, 'xr')
 for (const value of Object.values(harness)) value.mockReset()
 harness.setSession.mockResolvedValue(undefined)
})
afterEach(() => {
 if (originalXR) Object.defineProperty(navigator, 'xr', originalXR)
 else Reflect.deleteProperty(navigator, 'xr')
})
function fixture() {
 const session = { depthUsage: 'cpu-optimized', end: vi.fn(async () => undefined), requestReferenceSpace: vi.fn(async () => ({})), addEventListener: vi.fn() }
 const requestSession = vi.fn(async () => session)
 Object.defineProperty(navigator, 'xr', { configurable: true, value: { requestSession } })
 const end = vi.fn(), scanner = new BrowserDepthScanner('lifecycle-test', 'balanced', vi.fn(), end)
 const start = () => scanner.start(document.createElement('canvas'), document.createElement('div'))
 return { scanner, session, requestSession, end, start }
}
describe('WebXR startup cancellation (simulated runtime, no physical sensor evidence)', () => {
 it('ends a permission-delayed session instead of opening a renderer after stop', async () => {
  const f = fixture(), pending = deferred<typeof f.session>()
  f.requestSession.mockReturnValue(pending.promise)
  const starting = f.start(), rejected = expect(starting).rejects.toMatchObject({ code: 'CAPTURE_CANCELLED' })
  await f.scanner.stop(); pending.resolve(f.session); await rejected
  expect(f.session.end).toHaveBeenCalledTimes(1)
  expect(harness.constructed).not.toHaveBeenCalled()
  expect(f.end).not.toHaveBeenCalled()
 })
 it('does not install a render loop after cancellation during renderer setup', async () => {
  const f = fixture(), pending = deferred<void>()
  harness.setSession.mockReturnValue(pending.promise)
  const starting = f.start(), rejected = expect(starting).rejects.toMatchObject({ code: 'CAPTURE_CANCELLED' })
  await flushPromises(); await f.scanner.stop(); pending.resolve(); await rejected
  expect(f.session.end).toHaveBeenCalledTimes(1)
  expect(f.session.requestReferenceSpace).not.toHaveBeenCalled()
  expect(harness.loop.mock.calls.every(([callback]) => callback === null)).toBe(true)
  expect(harness.dispose).toHaveBeenCalled()
 })
 it('does not install listeners after cancellation during reference-space setup', async () => {
  const f = fixture(), pending = deferred<object>()
  f.session.requestReferenceSpace.mockReturnValue(pending.promise)
  const starting = f.start(), rejected = expect(starting).rejects.toMatchObject({ code: 'CAPTURE_CANCELLED' })
  await flushPromises(); await f.scanner.stop(); pending.resolve({}); await rejected
  expect(f.session.end).toHaveBeenCalledTimes(1)
  expect(f.session.addEventListener).not.toHaveBeenCalled()
  expect(harness.loop.mock.calls.every(([callback]) => callback === null)).toBe(true)
 })
 it('starts and stops an active session and refuses reuse of a stopped scanner', async () => {
  const f = fixture(); await f.start()
  expect(harness.loop).toHaveBeenCalledWith(expect.any(Function))
  await f.scanner.stop(); await f.scanner.stop()
  expect(f.session.end).toHaveBeenCalledTimes(1)
  expect(harness.dispose).toHaveBeenCalledTimes(1)
  await expect(f.start()).rejects.toMatchObject({ code: 'CAPTURE_CANCELLED' })
  expect(f.requestSession).toHaveBeenCalledTimes(1)
 })
})
