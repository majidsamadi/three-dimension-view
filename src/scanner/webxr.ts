import * as THREE from 'three'
import { AppError, type GeometryData } from '@/domain/types'
import { VoxelFusion } from '@/domain/reconstruction'
import type { ScanProgress } from './native'
interface CpuDepth { getDepthInMeters(x: number, y: number): number }
type DepthFrame = XRFrame & { getDepthInformation(view: XRView): CpuDepth | null }
export class BrowserDepthScanner {
 private session?: XRSession; private renderer?: THREE.WebGLRenderer; private space?: XRReferenceSpace
 private fusion: VoxelFusion; private paused = false; private ending = false; private lastSample = 0; private startTime = 0; private frames = 0; private lastDepth = 0
 private world = new THREE.Scene(); private camera = new THREE.PerspectiveCamera(); private cloud?: THREE.Points
 constructor(private sessionId: string, quality: 'balanced'|'detail', private onProgress: (progress: ScanProgress) => void, private onEnd: () => void) { this.fusion = new VoxelFusion(quality === 'detail' ? .015 : .03, quality === 'detail' ? 200_000 : 100_000, quality === 'detail' ? 300_000 : 150_000) }
 async start(canvas: HTMLCanvasElement, overlay: HTMLElement): Promise<void> {
  if (!navigator.xr) throw new AppError('This browser does not expose WebXR. Use the native app on a supported phone, or import an existing model.', 'UNSUPPORTED')
  this.startTime = performance.now(); this.lastDepth = this.startTime
  try {
   // Must remain directly attached to the user's click; browsers require activation.
   this.session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['local', 'depth-sensing', 'dom-overlay'], optionalFeatures: [], domOverlay: { root: overlay }, depthSensing: { usagePreference: ['cpu-optimized'], dataFormatPreference: ['float32', 'luminance-alpha'] } } as XRSessionInit)
   if ((this.session as XRSession & { depthUsage?: string }).depthUsage !== 'cpu-optimized') throw new AppError('This browser cannot provide CPU depth data. No 3D capture was started.', 'UNSUPPORTED_DEPTH')
   this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false }); this.renderer.xr.enabled = true; this.renderer.xr.setReferenceSpaceType('local'); this.renderer.setSize(window.innerWidth, window.innerHeight); await this.renderer.xr.setSession(this.session)
   this.space = await this.session.requestReferenceSpace('local')
   this.session.addEventListener('end', () => { this.dispose(); if (!this.ending) this.onEnd() }, { once: true })
   this.session.addEventListener('visibilitychange', () => { if (this.session?.visibilityState !== 'visible') this.paused = true })
   this.renderer.setAnimationLoop((time, frame) => { try { this.tick(time, frame) } catch { this.paused = true; this.onProgress({ sessionId: this.sessionId, vertices: this.fusion.vertexCount, triangles: this.fusion.triangleCount, frames: this.frames, elapsedMs: performance.now() - this.startTime, tracking: 'Depth update unavailable', paused: true, budgetReached: this.fusion.capacityReached, preview: Array.from(this.fusion.preview(2000).positions), message: 'Depth tracking was interrupted. Stop to review the geometry already captured, or deliberately resume.' }) } })
  } catch (e) { await this.stop(); throw e }
 }
 private tick(time: number, frame?: XRFrame): void {
  if (!frame || !this.renderer || !this.space) return
  const pose = frame.getViewerPose(this.space)
  if (time - this.lastSample >= 220) {
   this.lastSample = time
   let tracking = pose ? 'Tracking' : 'Tracking lost — move slowly back to a familiar area', message = ''
   if (pose && !this.paused && !this.fusion.capacityReached) {
    const view = pose.views[0], depth = (frame as DepthFrame).getDepthInformation(view)
    if (depth) {
     this.lastDepth = performance.now(); const width = 48, height = 36, points = new Float32Array(width * height * 3).fill(NaN), inverse = new THREE.Matrix4().fromArray(view.projectionMatrix).invert(), world = new THREE.Matrix4().fromArray(view.transform.matrix), ray = new THREE.Vector3()
     for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const u = (x + .5) / width, v = (y + .5) / height, d = depth.getDepthInMeters(u, v)
      if (!Number.isFinite(d) || d < .15 || d > 8) continue
      ray.set(2 * u - 1, 1 - 2 * v, .5).applyMatrix4(inverse); ray.multiplyScalar(d / -ray.z).applyMatrix4(world); points.set(ray.toArray(), (y * width + x) * 3)
     }
     this.fusion.integrateGrid(points, width, height); this.frames++
     const preview = this.fusion.preview(4000)
     this.cloud?.geometry.dispose(); if (this.cloud) this.world.remove(this.cloud)
     const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(preview.positions, 3))
     const material = this.cloud?.material as THREE.PointsMaterial | undefined || new THREE.PointsMaterial({ color: 0x19d49a, size: .025 })
     this.cloud = new THREE.Points(geometry, material); this.world.add(this.cloud)
    } else tracking = 'Waiting for depth — move slowly sideways'
    if (performance.now() - this.lastDepth > 15_000) message = 'No depth received for 15 seconds. Nothing is being invented; try better light or stop and use a native capture.'
   }
   if (this.fusion.capacityReached) { this.paused = true; message = 'Capture limit reached. Save this scan, then create another section.' }
   this.onProgress({ sessionId: this.sessionId, vertices: this.fusion.vertexCount, triangles: this.fusion.triangleCount, frames: this.frames, elapsedMs: performance.now() - this.startTime, tracking, paused: this.paused, budgetReached: this.fusion.capacityReached, preview: Array.from(this.fusion.preview(2000).positions), message })
  }
  this.renderer.render(this.world, this.camera)
 }
 pause(): void { this.paused = true }
 resume(): void { if (!this.fusion.capacityReached) this.paused = false }
 snapshot(): GeometryData { return this.fusion.snapshot() }
 async stop(): Promise<void> { this.ending = true; const session = this.session; this.session = undefined; try { await session?.end() } catch { /* Session can already have ended. */ } this.dispose() }
 private dispose(): void { this.renderer?.setAnimationLoop(null); this.cloud?.geometry.dispose(); (this.cloud?.material as THREE.Material | undefined)?.dispose(); this.renderer?.dispose(); this.renderer = undefined }
}
