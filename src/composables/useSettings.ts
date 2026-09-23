import { reactive, toRaw, watch } from 'vue'
import { repository } from '@/data/database'
import { DEFAULT_SETTINGS, type Settings } from '@/domain/types'
import { toast } from './useToasts'

export const settings = reactive<Settings>({ ...DEFAULT_SETTINGS })
let ready = false
const media = window.matchMedia('(prefers-color-scheme: dark)')
function apply(): void {
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && media.matches)
  document.documentElement.setAttribute('theme-color', dark ? 'dark' : 'light')
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.documentElement.classList.toggle('reduce-motion', settings.reduceMotion)
}
export async function loadSettings(): Promise<void> {
  try { Object.assign(settings, await repository.getSettings()) }
  catch { toast('Device preferences could not be loaded. Using defaults.', 'warning') }
  ready = true; apply()
}
media.addEventListener('change', apply)
watch(settings, () => { apply(); if (ready) repository.saveSettings(structuredClone(toRaw(settings))).catch(() => toast('Preferences could not be saved on this device.', 'error')) }, { deep: true })
export function lengthLabel(metres: number, digits = 2): string { return `${(metres * (settings.units === 'ft' ? 3.280839895 : 1)).toFixed(digits)} ${settings.units}` }
export function areaLabel(squareMetres: number): string { return `${(squareMetres * (settings.units === 'ft' ? 10.763910417 : 1)).toFixed(1)} ${settings.units}²` }
export function byteLabel(bytes: number): string { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB` }
