import { ref, shallowRef, watch, onBeforeUnmount, type Ref } from 'vue'
import { repository } from '@/data/database'
import { decodeGeometry } from '@/domain/geometry'
import { AppError, type Project, type RenderScene } from '@/domain/types'
import { errorMessage } from '@/domain/validation'

export function useProject(id: Ref<string>) {
  const project = shallowRef<Project>(), scenes = shallowRef<RenderScene[]>([]), loading = ref(false), error = ref('')
  let generation = 0
  async function reload(): Promise<void> {
    const request = ++generation; loading.value = true; error.value = ''; project.value = undefined; scenes.value = []
    try {
      const result = await repository.get(id.value)
      if (!result) throw new AppError('This project is no longer on this device.', 'NOT_FOUND')
      if (request !== generation) return
      project.value = result
      const loaded: RenderScene[] = [], failures: string[] = []
      for (const scene of result.scenes) {
        try {
          const asset = await repository.asset(scene.geometryId, result.id)
          loaded.push({ scene, geometry: await decodeGeometry(asset.blob) })
        } catch { failures.push(scene.name) }
        if (request !== generation) return
      }
      if (request === generation) { scenes.value = loaded; if (failures.length) error.value = `Some scan data is missing or damaged (${failures.join(', ')}). Notes and available photos are still accessible. Restore a complete backup before editing or exporting.` }
    } catch (e) { if (request === generation) error.value = errorMessage(e) }
    finally { if (request === generation) loading.value = false }
  }
  watch(id, reload, { immediate: true })
  onBeforeUnmount(() => { generation++ })
  return { project, scenes, loading, error, reload }
}
