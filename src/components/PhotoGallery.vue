<script setup lang="ts">
import { ref, shallowRef, watch, onBeforeUnmount } from 'vue'
import type { Project, PhotoRecord } from '@/domain/types'
import { repository } from '@/data/database'
import { importPhoto } from '@/services/files'
import { errorMessage } from '@/domain/validation'
import { toast } from '@/composables/useToasts'
import AppIcon from './AppIcon.vue'
const props = defineProps<{ project: Project }>(), emit = defineEmits<{ changed: [] }>(), images = shallowRef<{ photo: PhotoRecord; url: string }[]>([]), loading = ref(false), selected = ref<string>(), input = ref<HTMLInputElement>()
let request = 0
function clear(): void { for (const p of images.value) URL.revokeObjectURL(p.url); images.value = [] }
watch(() => props.project, async project => { const current = ++request; clear(); const results: { photo: PhotoRecord; url: string }[] = []; for (const photo of project.photos) { try { const asset = await repository.asset(photo.assetId, project.id), url = URL.createObjectURL(asset.blob); results.push({ photo, url }) } catch { /* Missing photos do not hide other evidence. */ } } if (current === request) images.value = results; else for (const p of results) URL.revokeObjectURL(p.url) }, { immediate: true })
async function add(event: Event): Promise<void> {
 const files = (event.target as HTMLInputElement).files; if (!files?.length || loading.value) return
 if (props.project.photos.length + files.length > 128) { toast('A project can contain up to 128 reference photos.', 'error'); return }
 loading.value = true
 try { const next = structuredClone(props.project), assets = []; for (const file of files) { const value = await importPhoto(file, next.id, file.name); next.photos.push(value.photo); assets.push(value.asset) } await repository.save(next, props.project.revision, assets); emit('changed'); toast('Reference photos saved locally.', 'success') } catch (e) { toast(errorMessage(e), 'error') } finally { loading.value = false; if (input.value) input.value.value = '' }
}
onBeforeUnmount(() => { request++; clear() })
</script>
<template><section class="card detail-card"><div class="section-heading"><div><h2>Reference photos</h2><p>Photos are kept as photos, not presented as a 3D reconstruction.</p></div><button class="btn btn-outline-primary btn-sm" :disabled="loading" @click="input?.click()"><AppIcon name="camera" :size="18"/>{{ loading ? 'Saving…' : 'Add photos' }}</button><input ref="input" class="visually-hidden" type="file" multiple accept="image/jpeg,image/png,image/webp" @change="add"></div><div v-if="images.length" class="photo-grid"><button v-for="p in images" :key="p.photo.id" @click="selected = p.url"><img :src="p.url" :alt="p.photo.caption || p.photo.name" loading="lazy"><span>{{ p.photo.caption || p.photo.name }}</span></button></div><p v-else class="muted">A useful fallback for areas your scan doesn’t cover. Added photos have their metadata stripped.</p></section><Teleport to="body"><div v-if="selected" class="photo-lightbox" role="dialog" aria-modal="true" aria-label="Reference photo" tabindex="0" @click.self="selected = undefined" @keydown.esc="selected = undefined"><button class="icon-button" aria-label="Close photo" autofocus @click="selected = undefined"><AppIcon name="close"/></button><img :src="selected" alt="Selected project reference photo"></div></Teleport></template>
