<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import AppIcon from './AppIcon.vue'
withDefaults(defineProps<{ title: string; message: string; confirmLabel?: string; danger?: boolean; busy?: boolean }>(), { confirmLabel: 'Confirm', danger: false, busy: false })
const emit = defineEmits<{ confirm: []; cancel: [] }>(), panel = ref<HTMLElement>()
let previous: Element | null
function key(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('cancel')
  if (e.key !== 'Tab') return
  const elements = panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')
  if (!elements?.length) return
  const first = elements[0], last = elements[elements.length - 1]
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}
onMounted(() => { previous = document.activeElement; panel.value?.querySelector('button')?.focus(); document.addEventListener('keydown', key) })
onBeforeUnmount(() => { document.removeEventListener('keydown', key); if (previous instanceof HTMLElement) previous.focus() })
</script>
<template><Teleport to="body"><div class="dialog-backdrop" @click.self="!busy && emit('cancel')"><section ref="panel" class="confirm-dialog card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message"><div class="dialog-symbol" :class="{ danger }"><AppIcon :name="danger ? 'trash' : 'info'" :size="30"/></div><h2 id="confirm-title">{{ title }}</h2><p id="confirm-message">{{ message }}</p><div class="d-flex gap-2"><button class="btn btn-outline-secondary flex-fill" :disabled="busy" @click="emit('cancel')">Cancel</button><button class="btn flex-fill" :class="danger ? 'btn-danger' : 'btn-primary'" :disabled="busy" @click="emit('confirm')">{{ busy ? 'Working…' : confirmLabel }}</button></div></section></div></Teleport></template>
