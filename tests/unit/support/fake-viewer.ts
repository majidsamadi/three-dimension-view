import { vi } from 'vitest'
import { RENDERER_LABELS, VIEWER_INTERFACE_VERSION, type SharedViewerLike, type ViewerEvents } from '@/service/viewer-port'

/** Test mock of the ARC shared viewer (X.8.1). No ARC code is imported. */
export function createFakeViewer(renderer: 'webgpu' | 'webgl2-compatibility' = 'webgl2-compatibility'): SharedViewerLike & { emit: <K extends keyof ViewerEvents>(event: K, payload: ViewerEvents[K]) => void } {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  let selected: string | null = null
  let overlays = 0
  return {
    interfaceVersion: VIEWER_INTERFACE_VERSION,
    capability: () => ({ renderer, label: RENDERER_LABELS[renderer], countsAsWebGPU: renderer === 'webgpu' }),
    load: vi.fn(async source => ({ assetId: String(source.envelope.asset_id), version: String(source.envelope.version), nodes: [], triangles: 0 })),
    setInstances: vi.fn(async () => undefined),
    setCameraMode: vi.fn(),
    orbit: vi.fn(),
    zoom: vi.fn(),
    focus: vi.fn(),
    select: vi.fn((nodeId: string | null) => { selected = nodeId }),
    highlight: vi.fn(),
    showUncertainty: vi.fn(next => { overlays = next.length }),
    describe: () => `${RENDERER_LABELS[renderer]}. Home version 1. 1 node. Selected: ${selected ?? 'none'}. ${overlays} uncertainty regions.`,
    on(event, listener) {
      const set = listeners.get(event) || new Set()
      set.add(listener as (payload: unknown) => void)
      listeners.set(event, set)
      return () => { set.delete(listener as (payload: unknown) => void) }
    },
    emit(event, payload) { for (const listener of listeners.get(event) || []) listener(payload) },
    dispose: vi.fn(async () => undefined),
  }
}
