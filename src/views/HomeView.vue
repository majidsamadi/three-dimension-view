<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import ProjectCard from '@/components/ProjectCard.vue'
import SceneViewer from '@/components/SceneViewer.vue'
import NoticeBox from '@/components/NoticeBox.vue'
import { useLibrary } from '@/composables/useLibrary'
import { sampleProject } from '@/domain/sample'
import { decodeGeometry } from '@/domain/geometry'
import { repository } from '@/data/database'
import type { RenderScene } from '@/domain/types'
import { shallowRef } from 'vue'
import { toast } from '@/composables/useToasts'
import { errorMessage } from '@/domain/validation'
const router = useRouter(), { projects, loading, error, favorite } = useLibrary(), illustration = shallowRef<RenderScene[]>([]), busy = ref(false)
const totalScans = computed(() => projects.value.reduce((n, p) => n + p.scenes.filter(s => s.source !== 'sample').length, 0))
onMounted(async () => { const sample = sampleProject(); illustration.value = [{ scene: sample.project.scenes[0], geometry: await decodeGeometry(sample.assets[0].blob) }] })
async function openSample(): Promise<void> { if (busy.value) return; busy.value = true; try { const { project, assets } = sampleProject(); await repository.create(project, assets); await router.push(`/projects/${project.id}/view`) } catch (e) { toast(errorMessage(e), 'error') } finally { busy.value = false } }
</script>
<template><div class="container dashboard"><div class="welcome-line"><span><span class="live-dot"/>YOUR PRIVATE 3D WORKSPACE</span><RouterLink to="/device"><AppIcon name="phone" :size="16"/>Check your device<AppIcon name="arrow" :size="16"/></RouterLink></div>
  <section class="hero-card"><div class="hero-copy"><span class="eyebrow">A NEW PERSPECTIVE ON HOME</span><h1>Your space.<br>A whole new<br><em>dimension.</em></h1><p>Walk through a room. Capture its shape.<br>Keep the details that make it yours.</p><RouterLink to="/new" class="btn btn-primary btn-lg"><AppIcon name="scan"/>Create a new space<AppIcon name="arrow" :size="18"/></RouterLink><div class="hero-trust"><AppIcon name="shield" :size="17"/>On-device capture<span>·</span>No reconstruction server</div></div><div class="hero-model"><SceneViewer :scenes="illustration" :interactive="true" :show-tools="false" :grid="false"/><div class="model-tag"><AppIcon name="cube" :size="18"/><span><strong>A different point of view</strong><small>Interactive illustrative apartment</small></span></div><span class="orbit-hint">DRAG TO EXPLORE</span></div></section>
  <div class="workspace-metrics"><div><span class="metric-icon"><AppIcon name="folder"/></span><strong>{{ projects.length }}</strong><span>saved spaces</span></div><div><span class="metric-icon"><AppIcon name="scan"/></span><strong>{{ totalScans }}</strong><span>scans & imports</span></div><div><span class="metric-icon"><AppIcon name="lock"/></span><strong>Local</strong><span>by design</span></div></div>
  <section class="section-block"><div class="section-heading"><div><span class="eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2>Your spaces</h2></div><RouterLink to="/library" class="text-link">View all<AppIcon name="arrow" :size="18"/></RouterLink></div><NoticeBox v-if="error" kind="error">{{ error }}</NoticeBox><div v-if="loading" class="skeleton-grid" aria-label="Loading projects"><div v-for="i in 3" :key="i" class="skeleton-card"/></div><div v-else-if="projects.length" class="project-grid"><ProjectCard v-for="p in projects.slice(0, 3)" :key="p.id" :project="p" @favorite="favorite"/></div><div v-else class="first-space"><div class="first-space-icon"><AppIcon name="scan" :size="34"/></div><div><h3>Your first space starts here.</h3><p>Capture a room on a supported phone, or bring in a model you already have.</p></div><RouterLink to="/new" class="btn btn-outline-primary">Let’s get started<AppIcon name="arrow" :size="18"/></RouterLink></div></section>
  <div class="inspiration-row"><section class="guide-banner"><div class="guide-graphic"><AppIcon name="phone" :size="54"/><span class="scan-line"/></div><div><span class="eyebrow">A LITTLE PREPARATION. A BETTER SCAN.</span><h2>Make every angle count.</h2><p>Good light, a steady hand, and a clear path.</p><RouterLink to="/guide" class="text-link">Read the scanning guide<AppIcon name="arrow" :size="18"/></RouterLink></div></section><section class="sample-banner"><AppIcon name="spark" :size="29"/><h3>Take a look around.</h3><p>Try viewing, measuring and editing an illustrative sample. No camera needed.</p><button class="text-link" :disabled="busy" @click="openSample">{{ busy ? 'Opening…' : 'Explore the sample' }}<AppIcon name="arrow" :size="18"/></button></section></div>
  <div class="footnote"><AppIcon name="shield" :size="16"/>Your projects stay on this device until you deliberately export them. Back up anything important.</div>
</div></template>
