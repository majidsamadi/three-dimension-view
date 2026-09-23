<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { repository } from '@/data/database'
import { importModel } from '@/services/models'
import { archiveIsEncrypted, readArchive, remapImportedProject } from '@/domain/archive'
import { AppError, LIMITS } from '@/domain/types'
import { byteLabel } from '@/composables/useSettings'
import { errorMessage } from '@/domain/validation'
import { toast } from '@/composables/useToasts'
import PageHeading from '@/components/PageHeading.vue'
import AppIcon from '@/components/AppIcon.vue'
import NoticeBox from '@/components/NoticeBox.vue'
const route = useRoute(), router = useRouter(), id = computed(() => route.params.id ? String(route.params.id) : ''), file = ref<File>(), encrypted = ref(false), password = ref(''), error = ref(''), busy = ref(false), input = ref<HTMLInputElement>()
async function choose(event: Event): Promise<void> { const selected = (event.target as HTMLInputElement).files?.[0]; if (selected) await select(selected) }
async function select(selected: File): Promise<void> { file.value = undefined; error.value = ''; password.value = ''; encrypted.value = false; try { if (!selected.size || selected.size > LIMITS.archiveBytes) throw new AppError('Choose a file smaller than 256 MB. Model files are limited to 64 MB.'); if (!/\.(w3d|glb|ply|obj)$/i.test(selected.name)) throw new AppError('Select a W3D backup, GLB, PLY or OBJ model.'); file.value = selected; if (/\.w3d$/i.test(selected.name)) encrypted.value = await archiveIsEncrypted(selected) } catch (e) { error.value = errorMessage(e) } }
async function drop(event: DragEvent): Promise<void> { if (event.dataTransfer?.files[0]) await select(event.dataTransfer.files[0]) }
async function load(): Promise<void> {
 if (!file.value || busy.value) return; busy.value = true; error.value = ''
 try {
  if (/\.w3d$/i.test(file.value.name)) { const restored = await readArchive(file.value, password.value || undefined), fresh = remapImportedProject(restored.project, restored.assets); await repository.create(fresh.project, fresh.assets); toast('Project restored as a separate local copy.', 'success'); await router.push(`/projects/${fresh.project.id}`) }
  else { if (!id.value) throw new AppError('Create a space first to import an individual 3D model.'); const project = await repository.get(id.value); if (!project) throw new AppError('The selected space no longer exists.'); if (project.scenes.length >= LIMITS.scenes) throw new AppError('This space has reached its 64-section limit. Create another space.'); const { scene, asset } = await importModel(file.value, project.id); await repository.save({ ...project, scenes: [...project.scenes, scene] }, project.revision, [asset]); toast('Geometry imported locally. Review its scale in the editor.', 'success'); await router.push(`/projects/${id.value}`) }
 } catch (e) { error.value = errorMessage(e) } finally { busy.value = false; password.value = '' }
}
</script>
<template><div class="container narrow"><PageHeading :back="id ? `/projects/${id}` : '/library'" eyebrow="BRING YOUR SPACE WITH YOU" title="Import, don’t upload." subtitle="Your file is processed on this device. Nothing goes to a reconstruction server."/><section class="card form-card"><div class="import-dropzone" tabindex="0" role="button" aria-label="Choose a project or model file" @click="input?.click()" @keydown.enter="input?.click()" @keydown.space.prevent="input?.click()" @dragover.prevent @drop.prevent="drop"><AppIcon :name="file ? 'cube' : 'upload'" :size="46"/><h2>{{ file?.name || 'Drop a file into a new dimension.' }}</h2><p>{{ file ? byteLabel(file.size) : 'Choose a file, or drag it here.' }}</p><span class="format-pills"><span>W3D</span><span>GLB</span><span>PLY</span><span>OBJ</span></span></div><input ref="input" type="file" accept=".w3d,.glb,.ply,.obj" class="visually-hidden" @change="choose"><NoticeBox v-if="file && !id && !/\.w3d$/i.test(file.name)" kind="warning">For an individual model, <RouterLink to="/new">create a space</RouterLink> and choose “Import an existing model”. W3D backups can be restored directly here.</NoticeBox><template v-if="encrypted"><label class="form-label mt-3" for="import-password">Backup passphrase</label><input id="import-password" v-model="password" class="form-control" type="password" autocomplete="off" placeholder="The passphrase used when exporting"><p class="fine-print">There is no password reset for encrypted local backups.</p></template><NoticeBox v-if="error" kind="error">{{ error }}</NoticeBox><button class="btn btn-primary btn-lg w-100 mt-4" :disabled="busy || !file || (encrypted && !password) || (!id && file && !/\.w3d$/i.test(file.name))" @click="load">{{ busy ? 'Validating & importing…' : 'Import to this device' }}<AppIcon name="arrow"/></button><div class="import-notes"><p><strong>W3D:</strong> restores a new copy of the full project, including notes, outlines and reference photos.</p><p><strong>GLB / PLY / OBJ:</strong> geometry and vertex colours only. External resources, textures, compression and animations are not imported. Check the scale afterwards.</p></div></section></div></template>
