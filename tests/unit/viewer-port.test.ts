import { describe, expect, it, vi } from 'vitest'
import viewerJson from '../../contracts/draft/v0.4/fixtures/viewer/viewer-interface.v0.4.json'
import { createFakeViewer } from './support/fake-viewer'
import {
  DESCRIBE_MAX_CHARS,
  RENDERER_LABELS,
  VIEWER_EVENTS,
  VIEWER_INTERFACE_VERSION,
  VIEWER_METHODS,
  assertViewerContract,
  createUnavailableViewer,
  type SharedViewerLike,
  type ViewerEvents,
} from '@/service/viewer-port'

describe('shared viewer port (X.8.1)', () => {
  it('ARC-08 viewer mock implements viewer-interface.v0.4.json methods/events', () => {
    expect(VIEWER_INTERFACE_VERSION).toBe(viewerJson.interface_version)
    expect([...VIEWER_METHODS]).toEqual(viewerJson.methods)
    expect([...VIEWER_EVENTS]).toEqual(viewerJson.events)
    expect(RENDERER_LABELS).toEqual(viewerJson.renderer_labels)
    expect(DESCRIBE_MAX_CHARS).toBe(viewerJson.describe_max_chars)
    const mock = createFakeViewer()
    for (const method of viewerJson.methods) expect(typeof (mock as unknown as Record<string, unknown>)[method], method).toBe('function')
    expect(() => assertViewerContract(mock)).not.toThrow()
    expect(mock.capability().countsAsWebGPU).toBe(viewerJson.counts_as_webgpu['webgl2-compatibility'])
    expect(createFakeViewer('webgpu').capability().countsAsWebGPU).toBe(true)
    // Every listed event can be subscribed to and delivered.
    for (const event of viewerJson.events) {
      const listener = vi.fn()
      const off = mock.on(event as keyof ViewerEvents, listener)
      mock.emit(event as keyof ViewerEvents, {} as never)
      off()
      mock.emit(event as keyof ViewerEvents, {} as never)
      expect(listener, event).toHaveBeenCalledTimes(1)
    }
    mock.select('unit-box')
    mock.showUncertainty([{ regionId: 'r1', kind: 'unobserved', bounds: { min: [0, 0, 0], max: [1, 1, 1] }, label: 'Not observed' }])
    expect(mock.describe()).toMatch(/Compatibility view \(WebGL2\) — not WebGPU.*Selected: unit-box.*1 uncertainty/)
  })

  it('rejects viewers that break the contract', () => {
    const missing = { ...createFakeViewer() } as Partial<SharedViewerLike>
    delete missing.highlight
    expect(() => assertViewerContract(missing as SharedViewerLike)).toThrow(/highlight/)
    const lying = { ...createFakeViewer(), capability: () => ({ renderer: 'webgl2-compatibility' as const, label: RENDERER_LABELS['webgl2-compatibility'], countsAsWebGPU: true }) }
    expect(() => assertViewerContract(lying)).toThrow(/WebGPU/)
    const major2 = { ...createFakeViewer(), interfaceVersion: 'wisestay.viewer/2.0.0' } as unknown as SharedViewerLike
    expect(() => assertViewerContract(major2)).toThrow(/Unsupported/)
    const verbose = { ...createFakeViewer(), describe: () => 'x'.repeat(601) }
    expect(() => assertViewerContract(verbose)).toThrow(/600/)
  })

  it('the default viewer reports unsupported honestly', async () => {
    const viewer = createUnavailableViewer()
    expect(() => assertViewerContract(viewer)).not.toThrow()
    expect(viewer.capability()).toMatchObject({ renderer: 'unsupported', label: RENDERER_LABELS.unsupported, countsAsWebGPU: false })
    expect(viewer.describe()).toContain(RENDERER_LABELS.unsupported)
    const errors = vi.fn()
    viewer.on('error', errors)
    await expect(viewer.load({ envelope: {} as never, components: {} })).rejects.toThrow(RENDERER_LABELS.unsupported)
    expect(errors).toHaveBeenCalledWith({ code: 'UNSUPPORTED' })
    const disposed = vi.fn()
    viewer.on('disposed', disposed)
    await viewer.dispose()
    await viewer.dispose()
    expect(disposed).toHaveBeenCalledTimes(1)
  })
})
