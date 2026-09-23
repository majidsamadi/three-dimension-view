import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { AppError, type PhotoRecord, type AssetRecord } from '@/domain/types'
import { safeFilename } from '@/domain/validation'

export async function deliverFile(blob: Blob, name: string, share = false): Promise<void> {
  const filename = safeFilename(name.replace(/\.[^.]+$/, '')) + '.' + (name.split('.').pop() || 'w3d')
  if (Capacitor.isNativePlatform()) {
    const base64 = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onerror = () => reject(new AppError('Could not prepare the export.')); r.onload = () => resolve(String(r.result).split(',')[1]); r.readAsDataURL(blob) })
    const path = `exports/${crypto.randomUUID()}/${filename}`
    const { uri } = await Filesystem.writeFile({ directory: Directory.Cache, path, data: base64, recursive: true })
    try { await Share.share({ title: filename, url: uri, dialogTitle: 'Save or share your 3D file' }) }
    finally { setTimeout(() => { void Filesystem.deleteFile({ directory: Directory.Cache, path }).catch(() => undefined) }, 300_000) }
  } else if (share && navigator.canShare?.({ files: [new File([blob], filename, { type: blob.type })] })) {
    await navigator.share({ files: [new File([blob], filename, { type: blob.type })], title: filename })
  } else {
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
/** Decode and re-encode deliberately selected photos: strips EXIF/GPS and rejects active formats. */
export async function importPhoto(file: Blob, projectId: string, name = 'Photo'): Promise<{ photo: PhotoRecord; asset: AssetRecord }> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024 || !file.size) throw new AppError('Choose a JPEG, PNG or WebP photo smaller than 20 MB.')
  const bitmap = await createImageBitmap(file)
  try {
    if (bitmap.width * bitmap.height > 50_000_000) throw new AppError('This photo is too large. Resize it below 50 megapixels.')
    const factor = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * factor); canvas.height = Math.round(bitmap.height * factor)
    const context = canvas.getContext('2d'); if (!context) throw new AppError('Image processing is unavailable.')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new AppError('Photo processing failed.')), 'image/jpeg', 0.88))
    const id = crypto.randomUUID()
    return { photo: { id: crypto.randomUUID(), assetId: id, name: name.slice(0, 100), caption: '', capturedAt: new Date().toISOString(), panorama: false }, asset: { id, projectId, kind: 'photo', blob } }
  } finally { bitmap.close() }
}
