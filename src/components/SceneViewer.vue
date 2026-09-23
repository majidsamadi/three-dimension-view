<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { bufferGeometry, disposeObject } from '@/services/models'
import { cropGeometry, transformMatrix, transformPoint } from '@/domain/geometry'
import type { Annotation, Measurement, RenderScene, Vec3 } from '@/domain/types'
import AppIcon from './AppIcon.vue'
import { settings } from '@/composables/useSettings'
const props = withDefaults(defineProps<{ scenes: RenderScene[]; annotations?: Annotation[]; measurements?: Measurement[]; interactive?: boolean; mode?: 'orbit'|'top'|'walk'; pick?: boolean; wireframe?: boolean; grid?: boolean; pointSize?: number; showTools?: boolean; selectedSceneId?: string; pendingPoints?: Vec3[] }>(), { annotations: () => [], measurements: () => [], interactive: true, mode: 'orbit', pick: false, wireframe: false, grid: true, pointSize: .025, showTools: true, pendingPoints: () => [] })
const emit = defineEmits<{ pick: [hit: { sceneId: string; position: Vec3 }]; ready: []; error: [message: string] }>()
const host = ref<HTMLDivElement>(), canvas = ref<HTMLCanvasElement>(), failure = ref(''), activePin = ref<Annotation>(), walkStep = ref(0.3)
const pointOnly = computed(() => props.scenes.length > 0 && props.scenes.every(s => !s.geometry.indices.length))
let renderer: THREE.WebGLRenderer | undefined, world: THREE.Scene, camera: THREE.PerspectiveCamera, controls: OrbitControls, root: THREE.Group, marks: THREE.Group, grid: THREE.GridHelper, resize: ResizeObserver, frame = 0, disposed = false
let pointerStart: { x: number; y: number } | undefined, pointerLast: { x: number; y: number } | undefined, yaw = 0, pitch = 0, last = 0
const raycaster = new THREE.Raycaster(), keys = new Set<string>(), bounds = new THREE.Box3()
function rebuild(): void {
  if (!renderer) return
  disposeObject(root); root.clear()
  for (const { scene, geometry } of props.scenes) {
    const data = cropGeometry(geometry, scene.crop); if (!data.positions.length) continue
    const geom = bufferGeometry(data), selected = !props.selectedSceneId || props.selectedSceneId === scene.id
    const material = data.indices.length ? new THREE.MeshStandardMaterial({ vertexColors: !!data.colors.length, color: data.colors.length ? 0xffffff : 0x80a99a, roughness: .93, side: THREE.DoubleSide, wireframe: props.wireframe, transparent: !selected, opacity: selected ? 1 : .35 }) : new THREE.PointsMaterial({ vertexColors: !!data.colors.length, color: data.colors.length ? 0xffffff : 0x168e6c, size: props.pointSize, sizeAttenuation: true, transparent: !selected, opacity: selected ? 1 : .35 })
    const object = data.indices.length ? new THREE.Mesh(geom, material as THREE.MeshStandardMaterial) : new THREE.Points(geom, material as THREE.PointsMaterial)
    object.applyMatrix4(transformMatrix(scene.transform)); object.userData.sceneId = scene.id; root.add(object)
  }
  root.updateMatrixWorld(true); bounds.setFromObject(root)
  rebuildMarks(); grid.visible = props.grid
}
function rebuildMarks(): void {
  if (!renderer) return
  marks.traverse(o => { if (o instanceof THREE.Line) { o.geometry.dispose(); (o.material as THREE.Material).dispose() } }); disposeObject(marks); marks.clear()
  const pinMaterial = new THREE.MeshBasicMaterial({ color: 0x0ba479, depthTest: false })
  for (const pin of props.annotations) {
    const scene = props.scenes.find(s => s.scene.id === pin.sceneId)?.scene; if (!scene) continue
    const marker = new THREE.Mesh(new THREE.SphereGeometry(.075, 12, 8), pinMaterial.clone()); marker.position.fromArray(transformPoint(pin.position, scene.transform)); marker.renderOrder = 5; marker.userData.pinId = pin.id; marks.add(marker)
  }
  pinMaterial.dispose()
  const line = (points: THREE.Vector3[], color: number) => { const object = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, depthTest: false })); object.renderOrder = 4; marks.add(object) }
  for (const m of props.measurements) { const scene = props.scenes.find(s => s.scene.id === m.sceneId)?.scene; if (scene) line([new THREE.Vector3(...transformPoint(m.a, scene.transform)), new THREE.Vector3(...transformPoint(m.b, scene.transform))], 0xba6d1f) }
  const selected = props.scenes.find(s => s.scene.id === props.selectedSceneId)?.scene
  if (selected && props.pendingPoints.length) {
    const points = props.pendingPoints.map(p => new THREE.Vector3(...transformPoint(p, selected.transform))); line(points, 0xeb964c)
    for (const p of points) { const marker = new THREE.Mesh(new THREE.SphereGeometry(.055, 10, 8), new THREE.MeshBasicMaterial({ color: 0xeb964c, depthTest: false })); marker.position.copy(p); marks.add(marker) }
  }
  // Lines have their own disposal path (disposeObject also handles Mesh/Points).
}
function reset(): void {
  if (!renderer) return
  const size = bounds.isEmpty() ? 5 : Math.max(...bounds.getSize(new THREE.Vector3()).toArray(), 1), center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3())
  camera.up.set(0, 1, 0); controls.target.copy(center); controls.enabled = props.interactive && props.mode !== 'walk'
  controls.enableRotate = props.mode === 'orbit'; controls.maxDistance = Math.max(size * 10, 10); controls.minDistance = .1
  camera.near = .03; camera.far = Math.max(500, size * 20); camera.updateProjectionMatrix()
  if (props.mode === 'top') { camera.position.copy(center).add(new THREE.Vector3(0, size * 1.6, .0001)); camera.up.set(0, 0, -1) }
  else if (props.mode === 'walk') { camera.position.set(center.x, (bounds.isEmpty() ? 0 : bounds.min.y) + 1.6, (bounds.isEmpty() ? 3 : bounds.max.z) + .5); yaw = 0; pitch = 0; camera.rotation.order = 'YXZ'; camera.rotation.set(pitch, yaw, 0); return }
  else camera.position.copy(center).add(new THREE.Vector3(size * .9, size * .8, size * 1.05))
  camera.lookAt(center); controls.update()
}
function move(forward: number, side = 0): void { if (!camera || props.mode !== 'walk') return; const direction = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)); camera.position.addScaledVector(direction, forward); camera.position.addScaledVector(new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), side) }
function choose(event: PointerEvent): void {
  if (!renderer || !pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 7) return
  const rect = renderer.domElement.getBoundingClientRect(); raycaster.params.Points!.threshold = Math.max(props.pointSize * 2, .05); raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera)
  if (!props.pick) { const hit = raycaster.intersectObjects(marks.children).find(h => h.object.userData.pinId); if (hit) activePin.value = props.annotations.find(p => p.id === hit.object.userData.pinId); return }
  const objects = root.children.filter(o => !props.selectedSceneId || props.selectedSceneId === o.userData.sceneId), hit = raycaster.intersectObjects(objects)[0]
  if (hit) emit('pick', { sceneId: hit.object.userData.sceneId, position: hit.object.worldToLocal(hit.point.clone()).toArray() as Vec3 })
}
function pointerdown(e: PointerEvent): void { pointerStart = { x: e.clientX, y: e.clientY }; pointerLast = pointerStart; if (props.mode === 'walk') canvas.value?.setPointerCapture(e.pointerId) }
function pointermove(e: PointerEvent): void { if (props.mode !== 'walk' || !pointerLast || !e.buttons) return; yaw -= (e.clientX - pointerLast.x) * .005; pitch = THREE.MathUtils.clamp(pitch - (e.clientY - pointerLast.y) * .005, -1.4, 1.4); camera.rotation.set(pitch, yaw, 0, 'YXZ'); pointerLast = { x: e.clientX, y: e.clientY } }
function pointerup(e: PointerEvent): void { choose(e); pointerLast = undefined; pointerStart = undefined }
function keyboard(e: KeyboardEvent, down: boolean): void { if (props.mode !== 'walk' || !host.value?.contains(document.activeElement)) return; if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); if (down) keys.add(e.key); else keys.delete(e.key) } }
const down = (e: KeyboardEvent) => keyboard(e, true), up = (e: KeyboardEvent) => keyboard(e, false)
function focusPin(pin: Annotation): void { const scene = props.scenes.find(s => s.scene.id === pin.sceneId)?.scene; if (!scene || !renderer) return; const point = new THREE.Vector3(...transformPoint(pin.position, scene.transform)); const delta = camera.position.clone().sub(controls.target).normalize().multiplyScalar(2.5); controls.target.copy(point); camera.position.copy(point).add(delta); controls.update(); activePin.value = pin }
function fullscreen(): void { if (document.fullscreenElement) void document.exitFullscreen(); else void host.value?.requestFullscreen?.().catch(() => undefined) }
function screenshot(): string | undefined { if (!renderer) return; renderer.render(world, camera); return renderer.domElement.toDataURL('image/png') }
onMounted(() => {
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas.value!, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'default' }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace
    world = new THREE.Scene(); camera = new THREE.PerspectiveCamera(45, 1, .03, 500); root = new THREE.Group(); marks = new THREE.Group(); world.add(root, marks, new THREE.HemisphereLight(0xffffff, 0xa1b6aa, 2.7)); const light = new THREE.DirectionalLight(0xfff7e7, 2.2); light.position.set(5, 12, 6); world.add(light)
    grid = new THREE.GridHelper(40, 80, 0xadc4b7, 0xd1ded4); grid.position.y = -.03; world.add(grid)
    controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = !settings.reduceMotion; controls.dampingFactor = .09; controls.screenSpacePanning = true
    resize = new ResizeObserver(() => { const rect = host.value!.getBoundingClientRect(); renderer!.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false); camera.aspect = rect.width / Math.max(1, rect.height); camera.updateProjectionMatrix() }); resize.observe(host.value!)
    rebuild(); reset()
    const loop = (time: number) => { if (disposed || !renderer) return; frame = requestAnimationFrame(loop); const dt = Math.min((time - last) / 1000, .05); last = time; if (props.mode === 'walk') { move(((keys.has('w') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('s') || keys.has('ArrowDown') ? 1 : 0)) * dt * 1.5, ((keys.has('d') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('a') || keys.has('ArrowLeft') ? 1 : 0)) * dt * 1.5) } else controls.update(); renderer.render(world, camera) }
    frame = requestAnimationFrame(loop); emit('ready')
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
  } catch { failure.value = '3D graphics are unavailable on this device. Your project data is safe; use its photos, notes, floor plan or export.'; emit('error', failure.value) }
})
watch(() => props.scenes, (next, previous) => { rebuild(); if (camera && next.map(s => s.scene.id).join() !== previous.map(s => s.scene.id).join()) reset() }, { deep: false })
watch(() => [props.annotations, props.measurements, props.pendingPoints], rebuildMarks, { deep: true })
watch(() => [props.wireframe, props.selectedSceneId, props.pointSize], rebuild)
watch(() => props.grid, value => { if (grid) grid.visible = value })
watch(() => props.mode, reset)
onBeforeUnmount(() => { disposed = true; cancelAnimationFrame(frame); resize?.disconnect(); controls?.dispose(); if (world) { world.traverse(o => { if (o instanceof THREE.Line) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose() } }); disposeObject(world) } renderer?.dispose(); renderer?.forceContextLoss(); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) })
defineExpose({ reset, focusPin, screenshot })
</script>
<template><div ref="host" class="scene-viewer" :class="{ picking: pick }"><canvas ref="canvas" tabindex="0" role="img" :aria-label="pick ? '3D editing canvas. Select a visible surface to place a point.' : 'Interactive 3D model. Drag to orbit, pinch or scroll to zoom.'" @pointerdown="pointerdown" @pointermove="pointermove" @pointerup="pointerup" @pointercancel="pointerLast = undefined" @blur="keys.clear()"/><div v-if="failure" class="viewer-fallback"><AppIcon name="cube" :size="42"/><p>{{ failure }}</p></div><template v-else><div v-if="showTools" class="viewer-tools"><button class="icon-button" title="Reset view" aria-label="Reset 3D view" @click="reset"><AppIcon name="reset"/></button><button class="icon-button" title="Fullscreen" aria-label="Fullscreen 3D view" @click="fullscreen"><AppIcon name="fullscreen"/></button></div><span v-if="pointOnly" class="viewer-caption">Observed points · missing surfaces stay empty</span><div v-if="mode === 'walk'" class="walk-controls"><button aria-label="Move forward" @click="move(walkStep)"><AppIcon name="arrowup"/></button><div><button aria-label="Move left" @click="move(0, -walkStep)"><AppIcon name="back"/></button><button aria-label="Move backward" @click="move(-walkStep)"><AppIcon name="arrowup" style="transform:rotate(180deg)"/></button><button aria-label="Move right" @click="move(0, walkStep)"><AppIcon name="arrow"/></button></div><small>Drag to look · no collision protection</small></div><div v-if="activePin" class="annotation-popover"><button class="icon-button" aria-label="Close annotation" @click="activePin = undefined"><AppIcon name="close" :size="18"/></button><strong>{{ activePin.label }}</strong><p>{{ activePin.note }}</p></div></template></div></template>
