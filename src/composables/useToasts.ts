import { ref } from 'vue'
export interface ToastMessage { id: number; message: string; kind: 'success' | 'error' | 'info' | 'warning' }
export const toasts = ref<ToastMessage[]>([])
let nextId = 0
export function toast(message: string, kind: ToastMessage['kind'] = 'info'): void {
  const id = ++nextId; toasts.value.push({ id, message, kind }); if (toasts.value.length > 4) toasts.value.shift()
  window.setTimeout(() => dismissToast(id), kind === 'error' ? 14000 : 7000)
}
export function dismissToast(id: number): void { toasts.value = toasts.value.filter(v => v.id !== id) }
