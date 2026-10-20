<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import NoticeBox from '@/components/NoticeBox.vue'
import PageHeading from '@/components/PageHeading.vue'
import ServiceAccountPanel from '@/components/ServiceAccountPanel.vue'
import { useServiceAccount } from '@/composables/useServiceAccount'
import { errorMessage } from '@/domain/validation'
import { SERVICE_PUBLISH_COMPOSITION, createDefaultPublishComposition, type ServicePublishComposition } from '@/service/compositions'
import { PublicationReviewController, WITHDRAWAL_TEXT, type PublicationSnapshot } from '@/service/publication-review'
import { describePublishView } from '@/service/service-status'
import { SERVICE_VIEWER_FACTORY, assertViewerContract, createUnavailableViewerFactory, type SharedViewerLike } from '@/service/viewer-port'

// HSA-06.1–06.3 publication review. Published is shown only after the service confirms it.
const props = defineProps<{ fixture?: () => Promise<ServicePublishComposition> }>()
const route = useRoute()
const injected = inject(SERVICE_PUBLISH_COMPOSITION, null)
const composition = shallowRef<ServicePublishComposition>()
const snapshot = shallowRef<PublicationSnapshot>({ status: 'loading' })
const localError = ref('')
const withdrawReason = ref('')
const account = useServiceAccount(message => { localError.value = message })
let controller: PublicationReviewController | undefined
let unsubscribe: (() => void) | undefined
let epoch = 0
// Any viewer use goes through the versioned shared viewer interface (X.8.1); the default is unavailable.
const viewerFactory = inject(SERVICE_VIEWER_FACTORY, createUnavailableViewerFactory())
const viewerText = ref('')
let viewer: SharedViewerLike | undefined
let viewerDisposed = false
void viewerFactory().then(created => {
  if (viewerDisposed) { void created.dispose(); return }
  try {
    assertViewerContract(created)
    viewer = created
    viewerText.value = created.describe()
  } catch (e) {
    viewerText.value = `3D preview unavailable: ${errorMessage(e)}`
    void created.dispose()
  }
}).catch(e => { viewerText.value = `3D preview unavailable: ${errorMessage(e)}` })

const fixtureMode = computed(() => composition.value?.mode === 'synthetic-fixture')
const liveMode = computed(() => composition.value?.mode === 'live')
const summary = computed(() => describePublishView(snapshot.value))
const review = computed(() => snapshot.value.review)
const busy = computed(() => ['loading', 'approving', 'publishing', 'withdrawing'].includes(snapshot.value.status))
const versions = computed(() => snapshot.value.scene?.versions || [])

const reloadBlocked = computed(() => busy.value ? 'A request is running.' : null)
const approveBlocked = computed(() => {
  if (busy.value) return 'A request is running.'
  if (!review.value) return 'No version is shown.'
  if (review.value.reviewState === 'approved') return 'This exact version is already approved.'
  if (!review.value.canApprove) return review.value.validation === 'quarantined' ? 'Quarantined versions cannot be approved.' : 'Only the scene owner can approve a validated version.'
  return null
})
const publishBlocked = computed(() => {
  if (busy.value) return 'A request is running.'
  if (snapshot.value.status === 'conflict') return 'Re-read the scene first: it changed elsewhere.'
  if (snapshot.value.status === 'withdrawn') return 'This scene was withdrawn.'
  if (!review.value) return 'No version is shown.'
  return review.value.publishBlockedReason
})
const withdrawBlocked = computed(() => {
  if (busy.value) return 'A request is running.'
  if (!review.value) return snapshot.value.status === 'withdrawn' ? 'This scene is already withdrawn.' : 'No published version is shown.'
  if (review.value.withdrawBlockedReason) return review.value.withdrawBlockedReason
  if (!withdrawReason.value.trim()) return 'Give a reason for withdrawing.'
  return null
})

function attach(next: PublicationReviewController): void {
  unsubscribe?.()
  controller = next
  snapshot.value = next.snapshot()
  unsubscribe = next.subscribe(value => { if (controller === next) snapshot.value = value })
}

async function setup(): Promise<void> {
  const request = ++epoch
  localError.value = ''
  snapshot.value = { status: 'loading' }
  try {
    const next = injected || (props.fixture ? await props.fixture() : createDefaultPublishComposition())
    if (request !== epoch) return
    composition.value = next
    await account.attach(next.account)
    if (request !== epoch) return
    const sceneId = String(route.params.sceneId || next.fixtureSceneId || '')
    const created = new PublicationReviewController(sceneId, next.api)
    attach(created)
    await created.load()
  } catch (e) {
    if (request === epoch) localError.value = errorMessage(e)
  }
}

function chooseVersion(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (value && !reloadBlocked.value) void controller?.load(value)
}
function reload(): void { if (!reloadBlocked.value) void controller?.load(snapshot.value.selected) }
function approve(): void { if (!approveBlocked.value) void controller?.approve() }
function publish(): void { if (!publishBlocked.value) void controller?.publish() }
function withdraw(): void { if (!withdrawBlocked.value) void controller?.withdraw(withdrawReason.value) }
function signIn(): void { void account.signIn(route.fullPath) }
// Re-read after signing out so no scene detail from the ended session stays on screen.
function signOut(): void { void account.signOut().then(() => setup()) }

watch(() => route.params.sceneId, () => { void setup() }, { immediate: true })
onBeforeUnmount(() => { epoch++; unsubscribe?.(); account.dispose(); viewerDisposed = true; void viewer?.dispose() })
</script>

<template>
  <div class="container narrow">
    <PageHeading back="/" eyebrow="SERVICE MODE · PUBLICATION" title="Review before publishing." subtitle="Check the exact version and what viewers receive. A publication counts only when the service confirms it."/>
    <NoticeBox v-if="fixtureMode" kind="warning"><strong>Prototype / synthetic / not connected.</strong> This review fixture uses an in-memory synthetic service. Nothing leaves the browser.</NoticeBox>
    <NoticeBox v-else-if="liveMode" kind="info"><strong>Home Scanner development service.</strong> Requests go through your WiseStay session. Use synthetic content only.</NoticeBox>
    <NoticeBox v-else kind="info"><strong>Not connected.</strong> The Home Scanner service connection is not wired in this build. Every request answers “not connected”.</NoticeBox>
    <ServiceAccountPanel :state="account.state.value" :busy="account.busy.value" @sign-in="signIn" @sign-out="signOut"/>

    <section class="card detail-card service-status" :data-status="summary.status" aria-labelledby="service-publish-status-heading">
      <span id="service-publish-status-heading" class="eyebrow">PUBLICATION STATUS</span>
      <p class="service-status-headline" role="status" aria-live="polite">{{ summary.headline }}</p>
      <p v-if="snapshot.problem" class="fine-print">Service answer: {{ snapshot.problem.status }} {{ snapshot.problem.code }}</p>
      <p v-if="snapshot.withdrawResult" class="fine-print">New access blocked at {{ snapshot.withdrawResult.new_access_blocked_at }}. Issued view links expire by {{ snapshot.withdrawResult.outstanding_view_grants_expire_by }}.</p>
      <p v-if="snapshot.publishResult?.superseded_version" class="fine-print">Version {{ snapshot.publishResult.superseded_version }} was replaced and is no longer published.</p>
    </section>
    <NoticeBox v-if="localError" kind="error">{{ localError }}</NoticeBox>

    <section v-if="versions.length" class="card detail-card" aria-labelledby="version-heading">
      <h2 id="version-heading">Exact version</h2>
      <label class="form-label" for="service-version">Version to review</label>
      <select id="service-version" class="form-select" :value="snapshot.selected || ''" :disabled="busy" @change="chooseVersion">
        <option v-for="item in versions" :key="item.version" :value="item.version" :disabled="item.state !== 'validated'">Version {{ item.version }} · {{ item.state }} · {{ item.review_state }}</option>
      </select>
    </section>

    <section v-if="review" class="card detail-card publication-review" aria-labelledby="review-heading">
      <h2 id="review-heading">{{ review.versionLabel }} of scene {{ review.sceneId }}</h2>
      <div class="stat-pair"><span>Validation</span><strong>{{ review.validation }}</strong></div>
      <div class="stat-pair"><span>Review</span><strong>{{ review.reviewState }}</strong></div>
      <div class="stat-pair"><span>Content</span><strong>{{ review.contentClass }}</strong></div>
      <div class="stat-pair"><span>Audience</span><strong>{{ review.audience }}</strong></div>
      <div class="stat-pair"><span>Audience projection</span><strong>{{ review.projectionId || 'Not read (version not approved)' }}</strong></div>
      <div v-if="review.projectionComponents.length" class="stat-pair"><span>Parts viewers receive</span><strong>{{ review.projectionComponents.join(', ') }}</strong></div>
      <div v-if="review.replaces" class="stat-pair"><span>Replaces published version</span><strong>{{ review.replaces }}</strong></div>
      <h3 id="excluded-heading" class="h6 mt-3">Never shown to viewers</h3>
      <ul aria-labelledby="excluded-heading"><li v-for="item in review.excludedCategories" :key="item">{{ item }}</li></ul>
      <p class="fine-print">{{ review.occupiedNote }}</p>
      <p class="fine-print service-viewer-text">3D preview: {{ viewerText || 'Checking the shared viewer.' }}</p>
    </section>

    <section v-if="snapshot.scene" class="card detail-card" aria-labelledby="publish-actions-heading">
      <h2 id="publish-actions-heading">Actions</h2>
      <div class="d-flex flex-wrap gap-2">
        <button class="btn btn-outline-primary" type="button" :disabled="Boolean(reloadBlocked)" @click="reload">Re-read scene</button>
        <button class="btn btn-outline-primary" type="button" :disabled="Boolean(approveBlocked)" :aria-describedby="approveBlocked ? 'approve-reason' : undefined" @click="approve">Approve this version</button>
        <button class="btn btn-primary" type="button" :disabled="Boolean(publishBlocked)" :aria-describedby="publishBlocked ? 'publish-reason' : undefined" @click="publish">Publish this version</button>
      </div>
      <p v-if="approveBlocked" id="approve-reason" class="fine-print mt-2">Approve is unavailable: {{ approveBlocked }}</p>
      <p v-if="publishBlocked" id="publish-reason" class="fine-print">Publish is unavailable: {{ publishBlocked }}</p>
      <h3 class="h6 mt-3">Withdraw publication</h3>
      <p>{{ WITHDRAWAL_TEXT }}</p>
      <label class="form-label" for="withdraw-reason">Reason for withdrawing</label>
      <input id="withdraw-reason" v-model="withdrawReason" class="form-control" type="text" maxlength="500" :disabled="busy">
      <button class="btn btn-outline-danger mt-2" type="button" :disabled="Boolean(withdrawBlocked)" :aria-describedby="withdrawBlocked ? 'withdraw-reason-text' : undefined" @click="withdraw">Withdraw publication</button>
      <p v-if="withdrawBlocked" id="withdraw-reason-text" class="fine-print mt-2">Withdraw is unavailable: {{ withdrawBlocked }}</p>
      <p class="fine-print">Two-device delivery to a named viewer is not available in this slice (HSA-06.4).</p>
    </section>
  </div>
</template>
