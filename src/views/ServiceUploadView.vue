<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import NoticeBox from '@/components/NoticeBox.vue'
import PageHeading from '@/components/PageHeading.vue'
import ServiceAccountPanel from '@/components/ServiceAccountPanel.vue'
import { useServiceAccount } from '@/composables/useServiceAccount'
import { errorMessage } from '@/domain/validation'
import {
  SERVICE_UPLOAD_COMPOSITION,
  buildUploadSelection,
  createDefaultUploadComposition,
  type ServiceProject,
  type ServiceUploadComposition,
} from '@/service/compositions'
import type { ContentClass } from '@/service/home-scanner-api'
import { describeUploadDisclosure } from '@/service/upload-disclosure'
import { describeUploadView } from '@/service/service-status'
import { UploadTransferController, type UploadTransferSnapshot } from '@/service/upload-transfer'

// HSA-05.1/05.2/05.4 service upload. Default composition is disconnected (503, no network);
// live mode (WebSession on the registered origin) adds WiseStay sign-in.
const props = defineProps<{ fixture?: () => Promise<ServiceUploadComposition> }>()
const route = useRoute()
const injected = inject(SERVICE_UPLOAD_COMPOSITION, null)
const composition = shallowRef<ServiceUploadComposition>()
const project = shallowRef<ServiceProject>()
const transfer = shallowRef<UploadTransferSnapshot>({ state: 'selecting', components: [], reasons: [], needsLocalBytes: false })
const loading = ref(true)
const preparing = ref(false)
const localError = ref('')
const consent = ref(false)
const propertyRef = ref('')
const contentClass = ref<ContentClass>('synthetic')
const account = useServiceAccount(message => { localError.value = message })
let controller: UploadTransferController | undefined
let unsubscribe: (() => void) | undefined
let epoch = 0

const projectId = computed(() => String(route.params.projectId || composition.value?.fixtureProjectId || ''))
const fixtureMode = computed(() => composition.value?.mode === 'synthetic-fixture')
const liveMode = computed(() => composition.value?.mode === 'live')
const disclosure = computed(() => project.value ? describeUploadDisclosure(project.value) : undefined)
const summary = computed(() => describeUploadView({ loading: loading.value, project: project.value, transfer: transfer.value }))
const property = computed(() => composition.value?.properties.find(item => item.reference === propertyRef.value))
const headerBack = computed(() => fixtureMode.value ? '/' : `/projects/${projectId.value}`)

const startBlocked = computed(() => {
  if (loading.value) return 'Reading the project.'
  if (!project.value) return 'The local project is not on this device.'
  if (transfer.value.state !== 'selecting') return 'An upload already exists for this project.'
  if (!project.value.sceneCount) return 'There is no scanned section to upload.'
  if (liveMode.value && account.state.value !== 'signed-in') return 'Sign in with WiseStay first.'
  if (!composition.value?.properties.length) return liveMode.value ? 'Property service not connected (Q14): no canonical property can be listed yet.' : 'No canonical property is available: the property service is not connected in this build.'
  if (!property.value) return 'Choose the canonical property this model belongs to.'
  if (property.value.propertyType === 'REAL') return 'Real properties need a permission record, which this slice does not collect.'
  if (!consent.value) return 'Confirm that the processed model may leave this device.'
  if (preparing.value) return 'Preparing the processed model on this device.'
  return null
})
const pauseBlocked = computed(() => ['admitted', 'transferring', 'retrying', 'url-expired'].includes(transfer.value.state) ? null : 'Nothing is uploading right now.')
const resumeBlocked = computed(() => {
  if (!['paused', 'retrying', 'url-expired'].includes(transfer.value.state)) return 'There is no paused upload to resume.'
  if (preparing.value) return 'Preparing the processed model on this device.'
  return null
})
const cancelBlocked = computed(() => {
  if (['selecting', 'cancelled'].includes(transfer.value.state)) return 'There is no upload to cancel.'
  if (['finalizing', 'validated', 'quarantined'].includes(transfer.value.state)) return 'The service has already received the whole upload.'
  if (transfer.value.state === 'failed' && !transfer.value.uploadId) return 'There is no upload to cancel.'
  return null
})

function attach(next: UploadTransferController): void {
  unsubscribe?.()
  controller = next
  transfer.value = next.snapshot()
  unsubscribe = next.subscribe(snapshot => { if (controller === next) transfer.value = snapshot })
}

async function load(): Promise<void> {
  const request = ++epoch
  loading.value = true
  localError.value = ''
  project.value = undefined
  try {
    const next = injected || (props.fixture ? await props.fixture() : createDefaultUploadComposition())
    if (request !== epoch) return
    composition.value = next
    propertyRef.value = next.properties.length === 1 ? next.properties[0].reference : ''
    await account.attach(next.account)
    if (request !== epoch) return
    const found = await next.readProject(projectId.value)
    if (request !== epoch) return
    project.value = found
    if (found) {
      const created = new UploadTransferController(found.id, { api: next.api, store: next.store, putComponent: next.putComponent })
      attach(created)
      loading.value = false
      await created.restore()
    }
  } catch (e) {
    if (request === epoch) localError.value = errorMessage(e)
  } finally {
    if (request === epoch) loading.value = false
  }
}

async function start(): Promise<void> {
  if (startBlocked.value || !controller || !composition.value || !property.value || !project.value) return
  preparing.value = true
  localError.value = ''
  try {
    const prepared = await composition.value.prepare(project.value.id)
    preparing.value = false
    await controller.start(buildUploadSelection({ projectId: project.value.id, property: property.value, contentClass: contentClass.value, prepared }))
  } catch (e) {
    localError.value = errorMessage(e)
  } finally {
    preparing.value = false
  }
}

async function resume(): Promise<void> {
  if (resumeBlocked.value || !controller || !composition.value || !project.value) return
  localError.value = ''
  try {
    if (transfer.value.needsLocalBytes) {
      preparing.value = true
      const prepared = await composition.value.prepare(project.value.id)
      preparing.value = false
      await controller.resume(prepared.components)
    } else {
      await controller.resume()
    }
  } catch (e) {
    localError.value = errorMessage(e)
  } finally {
    preparing.value = false
  }
}

function pause(): void { if (!pauseBlocked.value) controller?.pause() }
async function cancel(): Promise<void> { if (!cancelBlocked.value) await controller?.cancel() }
function signIn(): void { void account.signIn(route.fullPath) }
function signOut(): void { void account.signOut() }

watch(() => route.params.projectId, () => { void load() }, { immediate: true })
onBeforeUnmount(() => { epoch++; unsubscribe?.(); account.dispose() })
</script>

<template>
  <div class="container narrow">
    <PageHeading :back="headerBack" eyebrow="SERVICE MODE · UPLOAD" title="Upload a processed model." subtitle="Only a processed 3D model and its description leave this device, and only after you confirm."/>
    <NoticeBox v-if="fixtureMode" kind="warning"><strong>Prototype / synthetic / not connected.</strong> This review fixture uses an in-memory synthetic service. Nothing leaves the browser.</NoticeBox>
    <NoticeBox v-else-if="liveMode" kind="info"><strong>Home Scanner development service.</strong> Requests go through your WiseStay session. Use synthetic content only.</NoticeBox>
    <NoticeBox v-else kind="info"><strong>Not connected.</strong> The Home Scanner service connection is not wired in this build. Every request answers “not connected” and nothing leaves this device.</NoticeBox>
    <ServiceAccountPanel :state="account.state.value" :busy="account.busy.value" @sign-in="signIn" @sign-out="signOut"/>
    <NoticeBox v-if="liveMode && !composition?.properties.length" kind="warning"><strong>Property service not connected (Q14).</strong> Uploads need a canonical property, and none can be listed yet.</NoticeBox>

    <section class="card detail-card service-status" :data-status="summary.status" aria-labelledby="service-upload-status-heading">
      <span id="service-upload-status-heading" class="eyebrow">UPLOAD STATUS</span>
      <p class="service-status-headline" role="status" aria-live="polite">{{ summary.headline }}</p>
      <p v-if="transfer.uploadId" class="fine-print">Upload {{ transfer.uploadId }}</p>
      <ul v-if="transfer.components.length" class="service-components">
        <li v-for="item in transfer.components" :key="item.component_id">Part {{ item.component_id }}: {{ item.state }}<template v-if="item.reason"> ({{ item.reason }})</template></li>
      </ul>
      <p v-if="transfer.reasons.length" class="fine-print">Reasons: {{ transfer.reasons.join(', ') }}</p>
      <p class="fine-print">Device capture is not qualified. The model is an unqualified local result (Q04).</p>
    </section>
    <NoticeBox v-if="localError" kind="error">{{ localError }}</NoticeBox>

    <section v-if="disclosure" class="card detail-card" aria-labelledby="leaves-heading">
      <h2 id="leaves-heading">What leaves this device</h2>
      <ul><li v-for="item in disclosure.leavesDevice" :key="item.category"><strong>{{ item.category }}.</strong> {{ item.detail }}</li></ul>
      <h2 id="stays-heading">What stays on this device</h2>
      <ul aria-labelledby="stays-heading"><li v-for="item in disclosure.staysLocal" :key="item.category"><strong>{{ item.category }}.</strong> {{ item.detail }}</li></ul>
      <h2 id="retention-heading">Retention</h2>
      <ul aria-labelledby="retention-heading"><li v-for="line in disclosure.retention" :key="line">{{ line }}</li></ul>
      <p class="fine-print service-cloud-note">{{ disclosure.cloudProcessing }}</p>
    </section>

    <section v-if="project" class="card detail-card" aria-labelledby="upload-controls-heading">
      <h2 id="upload-controls-heading">Upload “{{ project.name }}”</h2>
      <label class="form-label" for="service-property">Canonical property</label>
      <select id="service-property" v-model="propertyRef" class="form-select" :disabled="!composition?.properties.length || transfer.state !== 'selecting'">
        <option value="">No canonical property selected</option>
        <option v-for="item in composition?.properties || []" :key="item.reference" :value="item.reference">{{ item.label }} · {{ item.propertyType }}</option>
      </select>
      <label class="form-label mt-3" for="service-content-class">Content</label>
      <select id="service-content-class" v-model="contentClass" class="form-select" :disabled="transfer.state !== 'selecting'">
        <option value="synthetic">Synthetic content</option>
        <option value="permitted-unoccupied-reference">Permitted unoccupied reference</option>
      </select>
      <p class="fine-print">Occupied homes cannot be uploaded for publication (Q07).</p>
      <div class="form-check mt-2">
        <input id="service-consent" v-model="consent" class="form-check-input" type="checkbox" :disabled="transfer.state !== 'selecting'">
        <label class="form-check-label" for="service-consent">I confirm the processed model and its description may leave this device.</label>
      </div>
      <div class="d-flex flex-wrap gap-2 mt-3">
        <button class="btn btn-primary" type="button" :disabled="Boolean(startBlocked)" :aria-describedby="startBlocked ? 'start-reason' : undefined" @click="start">Start upload</button>
        <button class="btn btn-outline-primary" type="button" :disabled="Boolean(pauseBlocked)" :aria-describedby="pauseBlocked ? 'pause-reason' : undefined" @click="pause">Pause upload</button>
        <button class="btn btn-outline-primary" type="button" :disabled="Boolean(resumeBlocked)" :aria-describedby="resumeBlocked ? 'resume-reason' : undefined" @click="resume">Resume upload</button>
        <button class="btn btn-outline-secondary" type="button" :disabled="Boolean(cancelBlocked)" :aria-describedby="cancelBlocked ? 'cancel-reason' : undefined" @click="cancel">Cancel upload</button>
      </div>
      <p v-if="startBlocked" id="start-reason" class="fine-print mt-2">Start upload is unavailable: {{ startBlocked }}</p>
      <p v-if="pauseBlocked" id="pause-reason" class="fine-print">Pause is unavailable: {{ pauseBlocked }}</p>
      <p v-if="resumeBlocked" id="resume-reason" class="fine-print">Resume is unavailable: {{ resumeBlocked }}</p>
      <p v-if="cancelBlocked" id="cancel-reason" class="fine-print">Cancel is unavailable: {{ cancelBlocked }}</p>
      <p class="fine-print">Cancelling or a failed upload never deletes the local project or its scans.</p>
    </section>
  </div>
</template>
