import type { InjectionKey } from 'vue'
import type { AssetEnvelope } from './home-scanner-api'

/**
 * Local mirror of the ARC shared viewer interface (plan X.8.1, `viewer-interface.v0.4.json`).
 *
 * Status: component-tested (synthetic data only). ARC is not a dependency: this app talks to a
 * viewer only through this versioned shape, and tests use a mock. The default viewer is
 * unavailable and says so; no WebGPU support is claimed.
 */
export const VIEWER_INTERFACE_VERSION = 'wisestay.viewer/1.0.0-draft' as const
export type RendererKind = 'webgpu' | 'webgl2-compatibility' | 'unsupported'
export const RENDERER_LABELS = {
  webgpu: 'WebGPU view',
  'webgl2-compatibility': 'Compatibility view (WebGL2) — not WebGPU',
  unsupported: '3D view not supported on this device yet',
} as const satisfies Record<RendererKind, string>

export interface ViewerCapability {
  renderer: RendererKind
  label: string
  countsAsWebGPU: boolean
  limits?: { maxBufferSize: number; maxTextureDimension2D: number }
  reason?: string
}
export interface Bounds { min: [number, number, number]; max: [number, number, number] }
export interface SceneSource { envelope: AssetEnvelope; components: Record<string, ArrayBuffer | (() => Promise<ArrayBuffer>)> }
export interface LoadedScene { assetId: string; version: string; nodes: { nodeId: string; label: string; bounds: Bounds }[]; triangles: number }
export interface PlacedInstance {
  instanceId: string
  source: SceneSource
  position_m: [number, number, number]
  rotationDegY: number
  scaleMode: 'real' | 'illustrative'
  illustrativeScale?: number
  label: string
}
export interface UncertaintyOverlay { regionId: string; kind: 'unobserved' | 'estimated' | 'unknown-scale'; bounds: Bounds; label: string }
export interface ViewerEvents {
  capability: ViewerCapability
  loaded: LoadedScene
  selection: { nodeId: string | null; label: string | null }
  'device-lost': { reason: string; recoverable: boolean }
  error: { code: string }
  disposed: Record<string, never>
}

export interface SharedViewerLike {
  readonly interfaceVersion: typeof VIEWER_INTERFACE_VERSION
  capability(): ViewerCapability
  load(source: SceneSource, options?: { signal?: AbortSignal }): Promise<LoadedScene>
  setInstances(instances: PlacedInstance[]): Promise<void>
  setCameraMode(mode: 'orbit' | 'top'): void
  orbit(deltaYawRad: number, deltaPitchRad: number): void
  zoom(factor: number): void
  focus(target: { nodeId: string } | { bounds: Bounds }): void
  select(nodeId: string | null): void
  highlight(nodeIds: string[]): void
  showUncertainty(overlays: UncertaintyOverlay[]): void
  describe(): string
  on<K extends keyof ViewerEvents>(event: K, listener: (payload: ViewerEvents[K]) => void): () => void
  dispose(): Promise<void>
}

export type ViewerFactory = () => Promise<SharedViewerLike>
export const SERVICE_VIEWER_FACTORY: InjectionKey<ViewerFactory> = Symbol('SERVICE_VIEWER_FACTORY')

export const VIEWER_METHODS = [
  'capability', 'load', 'setInstances', 'setCameraMode', 'orbit', 'zoom', 'focus', 'select', 'highlight', 'showUncertainty', 'describe', 'on', 'dispose',
] as const satisfies ReadonlyArray<keyof SharedViewerLike>
export const VIEWER_EVENTS = ['capability', 'loaded', 'selection', 'device-lost', 'error', 'disposed'] as const satisfies ReadonlyArray<keyof ViewerEvents>
export const DESCRIBE_MAX_CHARS = 600

const major = (version: string): string => version.replace(/^wisestay\.viewer\//, '').split('.')[0]

/** Throws when a viewer does not match the X.8.1 shape this app relies on. */
export function assertViewerContract(viewer: SharedViewerLike): void {
  if (typeof viewer.interfaceVersion !== 'string' || major(viewer.interfaceVersion) !== major(VIEWER_INTERFACE_VERSION)) {
    throw new Error(`Unsupported viewer interface ${String(viewer.interfaceVersion)}`)
  }
  for (const method of VIEWER_METHODS) {
    if (typeof (viewer as unknown as Record<string, unknown>)[method] !== 'function') throw new Error(`Viewer is missing ${method}()`)
  }
  const capability = viewer.capability()
  if (!(capability.renderer in RENDERER_LABELS)) throw new Error(`Unknown renderer ${capability.renderer}`)
  if (capability.label !== RENDERER_LABELS[capability.renderer]) throw new Error('Renderer label does not match the shared label')
  if (capability.countsAsWebGPU !== (capability.renderer === 'webgpu')) throw new Error('Only the webgpu renderer counts as WebGPU')
  const text = viewer.describe()
  if (typeof text !== 'string' || !text.length || text.length > DESCRIBE_MAX_CHARS) throw new Error('describe() must be plain text of at most 600 characters')
}

/** Default viewer: reports `unsupported` honestly and never loads a scene. */
export function createUnavailableViewer(reason = 'No shared viewer is connected in this build.'): SharedViewerLike {
  const listeners = new Map<keyof ViewerEvents, Set<(payload: never) => void>>()
  let disposed = false
  let overlays = 0
  const capability: ViewerCapability = { renderer: 'unsupported', label: RENDERER_LABELS.unsupported, countsAsWebGPU: false, reason }
  const emit = <K extends keyof ViewerEvents>(event: K, payload: ViewerEvents[K]) => { for (const listener of listeners.get(event) || []) (listener as (value: ViewerEvents[K]) => void)(payload) }
  return {
    interfaceVersion: VIEWER_INTERFACE_VERSION,
    capability: () => ({ ...capability }),
    async load() { emit('error', { code: 'UNSUPPORTED' }); throw Object.assign(new Error(RENDERER_LABELS.unsupported), { code: 'UNSUPPORTED' }) },
    async setInstances() { /* Nothing is rendered by the unavailable viewer. */ },
    setCameraMode() { /* No camera. */ },
    orbit() { /* No camera. */ },
    zoom() { /* No camera. */ },
    focus() { /* No scene. */ },
    select() { emit('selection', { nodeId: null, label: null }) },
    highlight() { /* No scene. */ },
    showUncertainty(next) { overlays = next.length },
    describe: () => `${capability.label}. No scene loaded: asset kind and version not shown. 0 nodes. No node selected. ${overlays} uncertainty regions. ${reason}`,
    on(event, listener) {
      const set = listeners.get(event) || new Set()
      set.add(listener as (payload: never) => void)
      listeners.set(event, set)
      return () => { set.delete(listener as (payload: never) => void) }
    },
    async dispose() {
      if (disposed) return
      disposed = true
      emit('disposed', {})
      listeners.clear()
    },
  }
}

export const createUnavailableViewerFactory = (): ViewerFactory => async () => createUnavailableViewer()
