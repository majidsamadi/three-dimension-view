import { onMounted, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { Project } from '@/domain/types'
import { repository } from '@/data/database'
import { errorMessage } from '@/domain/validation'
import { toast } from './useToasts'
export function useLibrary() {
  const projects = shallowRef<Project[]>([]), loading = ref(true), error = ref(''); let version = 0, channel: BroadcastChannel | undefined
  async function reload(): Promise<void> { const request = ++version; loading.value = true; error.value = ''; try { const values = await repository.list(); if (request === version) projects.value = values } catch (e) { if (request === version) error.value = errorMessage(e) } finally { if (request === version) loading.value = false } }
  async function favorite(project: Project): Promise<void> { try { await repository.save({ ...project, favorite: !project.favorite }, project.revision); await reload() } catch (e) { toast(errorMessage(e), 'error') } }
  onMounted(() => { void reload(); window.addEventListener('workspace-change', reload); if (typeof BroadcastChannel !== 'undefined') { channel = new BroadcastChannel('three-dimension-view'); channel.onmessage = () => void reload() } })
  onBeforeUnmount(() => { version++; window.removeEventListener('workspace-change', reload); channel?.close() })
  return { projects, loading, error, reload, favorite }
}
