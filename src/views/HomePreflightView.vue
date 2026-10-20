<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { repository } from '@/data/database'
import { errorMessage } from '@/domain/validation'
import AppIcon from '@/components/AppIcon.vue'
import NoticeBox from '@/components/NoticeBox.vue'
import PageHeading from '@/components/PageHeading.vue'
import { HOME_PREFLIGHT_ADAPTERS, createDefaultHomePreflightAdapters } from '@/home/preflight-adapters'
import {
  HomePreflightController,
  type CapabilityFact,
  type HomePreflightSnapshot,
  type LocalProjectContext,
} from '@/home/preflight'
import { HOME_PREFLIGHT_STATUS_LABELS, describeHomePreflight } from '@/home/preflight-presentation'

const route = useRoute()
const projectId = computed(() => String(route.params.id))
const adapters = inject(HOME_PREFLIGHT_ADAPTERS, createDefaultHomePreflightAdapters())
const controller = shallowRef<HomePreflightController>()
const snapshot = shallowRef<HomePreflightSnapshot>()
const loading = ref(true)
const error = ref('')
const accountChanged = ref(false)
// A-R1: the controller contextRevision at which the displayed facts were read (or deliberately cleared).
const observedRevision = ref<number>()
let accountClears = 0
let viewEpoch = 0

const selectedProperty = computed(() => {
  const current = snapshot.value
  if (!current?.selectedPropertyRef) return undefined
  return current.propertyFacts.contexts.find(context => context.reference === current.selectedPropertyRef)
})
// Single summary state with a text alternative (HSA-02.3, HSA-08.1). Never "ready": capture is unqualified (Q04).
const presentation = computed(() => snapshot.value ? describeHomePreflight(snapshot.value, observedRevision.value, { accountChanged: accountChanged.value }) : undefined)
const capabilityRows = computed(() => {
  const facts = snapshot.value?.capabilities
  if (!facts) return []
  return [
    ['Capture', facts.capture],
    ['Viewing', facts.viewing],
    ['Measurement', facts.measurement],
    ['Offline / local readiness', facts.offline],
    ['Camera permission', facts.cameraPermission],
    ['Storage', facts.storage],
    ['Local assets', facts.assets],
  ] as Array<[string, CapabilityFact]>
})

function stateLabel(state: string): string {
  return ({
    available: 'Available', unavailable: 'Unavailable', unknown: 'Unknown', pressure: 'Pressure reported', unqualified: 'Available · unqualified',
    ready: 'Ready fact', 'pending-review': 'Pending review', 'virtual-research': 'Virtual / research',
  } as Record<string, string>)[state] || state
}

function setSnapshot(next: HomePreflightSnapshot, observed = false): void {
  snapshot.value = next
  if (observed) observedRevision.value = next.contextRevision
}

/** Starts a controller re-read and commits its loading snapshot so `loading` renders (A-R1). */
function beginRefresh(current: HomePreflightController): Promise<HomePreflightSnapshot> {
  const pending = current.refresh()
  setSnapshot(current.snapshot())
  return pending
}

function routeProperty(): string | undefined {
  const value = route.query.property
  return typeof value === 'string' && value ? value : undefined
}

async function refreshFacts(): Promise<void> {
  const current = controller.value
  if (!current) return
  const request = viewEpoch
  loading.value = true
  error.value = ''
  try {
    const clearsAtStart = accountClears
    const next = await beginRefresh(current)
    if (request === viewEpoch && controller.value === current) {
      // A completed re-read replaces facts cleared before it started; a clear during the read still wins.
      if (clearsAtStart === accountClears) accountChanged.value = false
      setSnapshot(next, true)
    }
  } catch (e) {
    if (request === viewEpoch && controller.value === current) error.value = errorMessage(e)
  } finally {
    if (request === viewEpoch && controller.value === current) loading.value = false
  }
}

function chooseProperty(event: Event): void {
  if (!controller.value) return
  const value = (event.target as HTMLSelectElement).value
  setSnapshot(controller.value.selectProperty(value || undefined))
}

function clearExternalContext(): void {
  if (!controller.value) return
  accountClears++
  accountChanged.value = true
  setSnapshot(controller.value.invalidateAccountContext(), true)
}

/**
 * The return context (`?property=`) changed while facts are shown. The controller moves to a new
 * context revision; the shown facts were read at an older one, so the summary renders `stale`
 * until they are re-read (A-R1).
 */
function returnContextChanged(): void {
  const current = controller.value
  if (!current || loading.value) return
  const reference = routeProperty()
  if (reference === current.snapshot().intent.canonicalPropertyRef) return
  setSnapshot(current.replaceIntent({ action: 'scan', localProjectId: current.snapshot().localProject.id, canonicalPropertyRef: reference }))
}

async function loadProject(id: string): Promise<void> {
  const request = ++viewEpoch
  loading.value = true
  error.value = ''
  controller.value = undefined
  snapshot.value = undefined
  accountChanged.value = false
  observedRevision.value = undefined
  try {
    const project = await repository.get(id)
    if (request !== viewEpoch) return
    if (!project) throw new Error('This local project is unavailable on this device.')
    const localProject: LocalProjectContext = { id: project.id, revision: project.revision, name: project.name, location: project.location }
    const current = new HomePreflightController(localProject, { action: 'scan', localProjectId: project.id, canonicalPropertyRef: routeProperty() }, adapters)
    controller.value = current
    setSnapshot(current.snapshot(), true)
    const next = await beginRefresh(current)
    if (request === viewEpoch && controller.value === current) setSnapshot(next, true)
  } catch (e) {
    if (request === viewEpoch) error.value = errorMessage(e)
  } finally {
    if (request === viewEpoch) loading.value = false
  }
}

watch(projectId, id => { void loadProject(id) }, { immediate: true })
watch(() => route.query.property, () => { returnContextChanged() })
onBeforeUnmount(() => { viewEpoch++ })
</script>

<template>
  <div class="container narrow">
    <PageHeading :back="`/projects/${projectId}`" eyebrow="CONNECTED HOME ENTRY · PREPARATION" title="Check context before capture." subtitle="Application-source preflight. It does not sign in, create a property, request camera access or start scanning."/>
    <NoticeBox kind="info"><strong>Development preparation · not connected.</strong> The existing local-first project stays intact. Identity and canonical property facts are injectable and default to unavailable until their owning integrations exist.</NoticeBox>
    <NoticeBox v-if="error" kind="error">{{ error }}</NoticeBox>
    <p v-if="loading" class="loading-state" role="status">Reading local project and available preflight facts…</p>

    <template v-if="snapshot">
      <section v-if="presentation" class="card detail-card preflight-summary" aria-labelledby="preflight-summary-heading" :data-status="presentation.status">
        <div class="section-heading"><div><span class="eyebrow">PREFLIGHT SUMMARY</span><h2 id="preflight-summary-heading">{{ presentation.headline }}</h2></div><span class="status-badge review">{{ HOME_PREFLIGHT_STATUS_LABELS[presentation.status] }}</span></div>
        <!-- A-R4: only headline plus explanation is live (visually hidden: the same words are shown in the heading and paragraph below); the full text alternative is a non-live paragraph. -->
        <p class="preflight-live visually-hidden" role="status" aria-live="polite">{{ presentation.headline }} {{ presentation.explanation }}</p>
        <p class="preflight-text-alternative">{{ presentation.textAlternative }}</p>
      </section>

      <section class="card detail-card">
        <div class="section-heading"><div><span class="eyebrow">LEGACY LOCAL PROJECT</span><h2>{{ snapshot.localProject.name }}</h2></div><span class="status-badge review">Unmatched local project</span></div>
        <div class="stat-pair"><span>Local project ID</span><strong>{{ snapshot.localProject.id }}</strong></div>
        <div class="stat-pair"><span>Local revision</span><strong>{{ snapshot.localProject.revision }}</strong></div>
        <div class="stat-pair"><span>Local location text</span><strong>{{ snapshot.localProject.location || 'Not supplied' }}</strong></div>
        <p class="fine-print">Name and location remain local source metadata. This screen never converts them into a Resvanta property or rewrites the project record.</p>
      </section>

      <section class="card detail-card">
        <div class="section-heading"><div><span class="eyebrow">INTENDED RETURN</span><h2>Scan this local project</h2></div><span class="count-pill">{{ snapshot.intent.action }}</span></div>
        <div class="stat-pair"><span>Local target</span><strong>{{ snapshot.intent.localProjectId }}</strong></div>
        <div class="stat-pair"><span>Requested canonical property</span><strong>{{ snapshot.intent.canonicalPropertyRef || 'Not supplied' }}</strong></div>
        <p class="fine-print">The intent is application state, not a credential, route registration, authorization result or property association.</p>
      </section>

      <section class="card detail-card">
        <div class="section-heading"><div><span class="eyebrow">CENTRAL IDENTITY</span><h2>Current account fact</h2></div><span class="status-badge" :class="snapshot.identity.state === 'available' ? 'saved' : 'review'">{{ stateLabel(snapshot.identity.state) }}</span></div>
        <p>{{ snapshot.identity.detail }}</p>
        <div v-if="snapshot.identity.userId" class="stat-pair"><span>Canonical user</span><strong>{{ snapshot.identity.userId }}</strong></div>
        <button class="btn btn-outline-primary" type="button" :disabled="loading" @click="refreshFacts"><AppIcon name="reset" :size="18"/>Re-read injected facts</button>
        <button class="btn btn-outline-secondary ms-2" type="button" @click="clearExternalContext">Clear external context presentation</button>
        <p class="fine-print">Neither action signs in or signs out. Clearing here only invalidates presented external facts; it is not an account lifecycle operation.</p>
      </section>

      <section class="card detail-card">
        <div class="section-heading"><div><span class="eyebrow">CANONICAL PROPERTY</span><h2>Authoritative context input</h2></div><span class="status-badge review">{{ stateLabel(snapshot.propertyFacts.state) }}</span></div>
        <p>{{ snapshot.propertyFacts.detail }}</p>
        <label class="form-label" for="canonical-property">Property reference supplied by adapter</label>
        <select id="canonical-property" class="form-select" :value="snapshot.selectedPropertyRef || ''" :disabled="!snapshot.propertyFacts.contexts.length" @change="chooseProperty">
          <option value="">No canonical association selected</option>
          <option v-for="context in snapshot.propertyFacts.contexts" :key="context.reference" :value="context.reference">{{ context.name }} · {{ stateLabel(context.state) }}</option>
        </select>
        <template v-if="selectedProperty">
          <div class="stat-pair mt-3"><span>Reference</span><strong>{{ selectedProperty.reference }}</strong></div>
          <div class="stat-pair"><span>Property kind</span><strong>{{ selectedProperty.kind }}</strong></div>
          <div class="stat-pair"><span>Context state</span><strong>{{ stateLabel(selectedProperty.state) }}</strong></div>
          <p class="fine-print">{{ selectedProperty.detail }}</p>
        </template>
        <NoticeBox v-else>No canonical property is associated by this screen. An unmatched local project remains unmatched.</NoticeBox>
      </section>

      <section class="card detail-card">
        <div class="section-heading"><div><span class="eyebrow">CAPABILITY PREFLIGHT</span><h2>Separate facts, no implied support.</h2></div></div>
        <div v-for="([label, fact]) in capabilityRows" :key="label" class="capability-row">
          <span class="capability-symbol" :class="{ yes: fact.state === 'available' }"><AppIcon :name="fact.state === 'available' ? 'check' : 'info'"/></span>
          <div><strong>{{ label }}</strong><p>{{ fact.detail }}</p></div>
          <span>{{ stateLabel(fact.state) }}</span>
        </div>
        <NoticeBox kind="warning">A camera API, viewer, stored project or local processing path does not by itself prove capture support, camera permission, measurement accuracy, offline readiness or asset completeness.</NoticeBox>
      </section>

      <section class="card detail-card">
        <h2>Real actions remain disabled in this preparation slice</h2>
        <div class="d-flex flex-wrap gap-2">
          <button class="btn btn-outline-primary" disabled>Sign in / return</button>
          <button class="btn btn-outline-primary" disabled>Select or create property</button>
          <button class="btn btn-outline-primary" disabled>Request camera permission</button>
          <button class="btn btn-primary" disabled>Start capture</button>
          <button class="btn btn-outline-primary" disabled>Measure</button>
          <button class="btn btn-outline-primary" disabled>Upload</button>
          <button class="btn btn-outline-primary" disabled>Migrate legacy project</button>
        </div>
        <p class="fine-print mt-3">Use the existing project screens for current local capture, viewing, backup/export and recovery. This preflight performs no conversion, upload, deletion or property-master write.</p>
      </section>
    </template>
  </div>
</template>
