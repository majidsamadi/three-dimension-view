<script setup lang="ts">
import { ref, onErrorCaptured, onMounted, onBeforeUnmount } from 'vue'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { toasts, dismissToast, toast } from '@/composables/useToasts'
import AppShell from '@/components/AppShell.vue'
import AppIcon from '@/components/AppIcon.vue'
const fatal = ref(''), online = ref(navigator.onLine)
const { needRefresh, updateServiceWorker } = useRegisterSW({ onRegisterError() { toast('Offline installation is unavailable. Keep the app open or use the native build when disconnected.', 'warning') } })
function connectivity(): void { online.value = navigator.onLine }
onMounted(() => { window.addEventListener('online', connectivity); window.addEventListener('offline', connectivity) })
onBeforeUnmount(() => { window.removeEventListener('online', connectivity); window.removeEventListener('offline', connectivity) })
onErrorCaptured(error => { fatal.value = error instanceof Error ? error.message : 'An unexpected view error occurred.'; return false })
</script>
<template><AppShell><div v-if="fatal" class="container fatal-error" role="alert"><AppIcon name="warning" :size="42"/><h1>This view couldn’t finish loading.</h1><p>Your saved projects have not been intentionally removed.</p><details><summary>Error details</summary><p>{{ fatal }}</p></details><button class="btn btn-primary" @click="fatal = ''; $router.push('/')">Return home</button></div><RouterView v-else/></AppShell><div v-if="!online" class="offline-chip" role="status"><AppIcon name="wifi" :size="14"/>Offline · local workspace</div><div class="toast-stack" aria-live="polite" aria-atomic="false"><div v-for="message in toasts" :key="message.id" class="app-toast" :class="message.kind" :role="message.kind === 'error' ? 'alert' : 'status'"><AppIcon :name="message.kind === 'success' ? 'check' : message.kind === 'error' ? 'warning' : 'info'" :size="21"/><span>{{ message.message }}</span><button class="icon-button" :aria-label="`Dismiss ${message.kind} message`" @click="dismissToast(message.id)"><AppIcon name="close" :size="17"/></button></div></div><div v-if="needRefresh" class="update-banner" role="status"><span>A new app version is ready. Save your edits and stop scanning before reloading.</span><button class="btn btn-primary btn-sm" @click="updateServiceWorker(true)">Reload</button><button class="icon-button" aria-label="Update later" @click="needRefresh = false"><AppIcon name="close" :size="17"/></button></div></template>
