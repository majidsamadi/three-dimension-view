<script setup lang="ts">
import { computed, inject, onMounted, ref, shallowRef } from 'vue'
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

const route = useRoute()
const projectId = computed(() => String(route.params.id))
const adapters = inject(HOME_PREFLIGHT_ADAPTERS, createDefaultHomePreflightAdapters())
const controller = shallowRef<HomePreflightController>()
const snapshot = shallowRef<HomePreflightSnapshot>()
const loading = ref(true)
const error = ref('')

const selectedProperty = computed(() => controller.value?.selectedProperty())
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

function setSnapshot(next: HomePreflightSnapshot): void { snapshot.value = next }

async function refreshFacts(): Promise<void> {
  if (!controller.value) return
  loading.value = true
  error.value = ''
  try { setSnapshot(await controller.value.refresh()) }
  catch (e) { error.value = errorMessage(e) }
  finally { loading.value = false }
}

function chooseProperty(event: Event): void {
  if (!controller.value) return
  const value = (event.target as HTMLSelectElement).value
  setSnapshot(controller.value.selectProperty(value || undefined))
}

function clearExternalContext(): void {
  if (!controller.value) return
  setSnapshot(controller.value.invalidateAccountContext())
}

onMounted(async () => {
  try {
    const project = await repository.get(projectId.value)
    if (!project) throw new Error('This local project is unavailable on this device.')
    const localProject: LocalProjectContext = { id: project.id, revision: project.revision, name: project.name, location: project.location }
    controller.value = new HomePreflightController(localProject, { action: 'scan', localProjectId: project.id }, adapters)
    setSnapshot(controller.value.snapshot())
    await refreshFacts()
  } catch (e) { error.value = errorMessage(e); loading.value = false }
})
</script>

<template>
  <div class="container narrow">
    <PageHeading :back="`/projects/${projectId}`" eyebrow="CONNECTED HOME ENTRY · PREPARATION" title="Check context before capture." subtitle="Application-source preflight. It does not sign in, create a property, request camera access or start scanning."/>
    <NoticeBox kind="info"><strong>Development preparation · not connected.</strong> The existing local-first project stays intact. Identity and canonical property facts are injectable and default to unavailable until their owning integrations exist.</NoticeBox>
    <NoticeBox v-if="error" kind="error">{{ error }}</NoticeBox>
    <p v-if="loading" class="loading-state" role="status">Reading local project and available preflight facts…</p>

    <template v-if="snapshot">
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
