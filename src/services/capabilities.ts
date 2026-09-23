import { Capacitor } from '@capacitor/core'
import { nativeScannerAvailable, PhoneScanner, type NativeCapabilities } from '@/scanner/native'
export interface Capabilities { secure: boolean; camera: boolean; webgl: boolean; xr: boolean; native?: NativeCapabilities; nativeError?: string; storage?: { usage?: number; quota?: number }; persistent: boolean; platform: string }
export async function getCapabilities(): Promise<Capabilities> {
  const c = document.createElement('canvas'), gl = c.getContext('webgl2'), webgl = Boolean(gl)
  gl?.getExtension('WEBGL_lose_context')?.loseContext()
  const result: Capabilities = { secure: window.isSecureContext, camera: !!navigator.mediaDevices?.getUserMedia, webgl, xr: false, persistent: false, platform: Capacitor.getPlatform() }
  if (nativeScannerAvailable()) { try { result.native = await PhoneScanner.getCapabilities() } catch { result.nativeError = 'The installed native scanner could not be queried. Reopen the app or check its native build.' } }
  if (navigator.xr) { try { result.xr = await navigator.xr.isSessionSupported('immersive-ar') } catch { /* Permission policy or unsupported browser. */ } }
  try { result.storage = await navigator.storage?.estimate(); result.persistent = (await navigator.storage?.persisted?.()) || false } catch { /* Storage estimate is advisory. */ }
  return result
}
