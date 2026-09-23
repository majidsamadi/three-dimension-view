import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { z } from 'zod'
import { AppError, type CaptureSource, type GeometryData } from '@/domain/types'
import { validateGeometry } from '@/domain/validation'
export interface NativeCapabilities { platform: string; available: boolean; support: 'supported'|'unsupported'|'needs-check'; reason: string; source: CaptureSource; canPause: boolean }
export interface ScanProgress { sessionId: string; vertices: number; triangles: number; frames: number; elapsedMs: number; tracking: string; paused: boolean; budgetReached: boolean; preview: number[]; message?: string }
export interface NativeResult { sessionId: string; projectId: string; source: CaptureSource; vertices: number; indices: number; elapsedMs: number; capturedAt: string; warnings: string[] }
interface PhoneScannerPlugin {
 getCapabilities(): Promise<NativeCapabilities>
 start(options: { sessionId: string; projectId: string; quality: string }): Promise<void>
 pause(): Promise<void>; resume(): Promise<void>; stop(): Promise<NativeResult>; cancel(): Promise<void>
 getRecoveries(): Promise<{ results: NativeResult[] }>
 readChunk(options: { sessionId: string; vertexOffset: number; vertexCount: number; indexOffset: number; indexCount: number }): Promise<{ positions: number[]; colors: number[]; indices: number[] }>
 discard(options: { sessionId: string }): Promise<void>
 addListener(event: 'progress', listener: (event: ScanProgress) => void): Promise<PluginListenerHandle>
}
export const PhoneScanner = registerPlugin<PhoneScannerPlugin>('PhoneScanner')
export function nativeScannerAvailable(): boolean { return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('PhoneScanner') }
const resultSchema = z.object({ sessionId: z.string().uuid(), projectId: z.string().uuid(), source: z.enum(['arkit-mesh', 'arcore-depth']), vertices: z.number().int().min(1).max(500_000), indices: z.number().int().min(0).max(3_000_000), elapsedMs: z.number().min(0).max(86_400_000), capturedAt: z.string().datetime(), warnings: z.array(z.string().max(500)).max(20) })
export async function readNativeResult(raw: NativeResult, progress?: (percent: number) => void): Promise<{ geometry: GeometryData; result: NativeResult }> {
  const check = resultSchema.safeParse(raw)
  if (!check.success) throw new AppError('The native scanner returned an invalid or empty capture. No project was overwritten.', 'INVALID_SCAN')
  const result = check.data
  if (result.indices % 3) throw new AppError('The scan triangle data is incomplete.', 'INVALID_SCAN')
  const positions = new Float32Array(result.vertices * 3), colors = new Float32Array(positions.length), indices = new Uint32Array(result.indices)
  let v = 0, i = 0
  while (v < result.vertices || i < result.indices) {
    const vc = Math.min(4096, result.vertices - v), ic = Math.min(12288, result.indices - i), chunk = await PhoneScanner.readChunk({ sessionId: result.sessionId, vertexOffset: v, vertexCount: vc, indexOffset: i, indexCount: ic })
    if (chunk.positions.length !== vc * 3 || chunk.colors.length !== vc * 3 || chunk.indices.length !== ic || chunk.indices.some(index => !Number.isInteger(index) || index < 0 || index >= result.vertices)) throw new AppError('The native scan transfer is incomplete. Its recovery copy remains on this phone.', 'INVALID_SCAN')
    positions.set(chunk.positions, v * 3); colors.set(chunk.colors, v * 3); indices.set(chunk.indices, i); v += vc; i += ic
    progress?.(Math.round((v * 3 + i) / (positions.length + indices.length) * 100))
  }
  const geometry = { positions, colors, indices }; validateGeometry(geometry); return { geometry, result }
}
