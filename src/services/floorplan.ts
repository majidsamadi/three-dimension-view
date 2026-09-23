import type { Project } from '@/domain/types'
import { polygonArea, transformPoint } from '@/domain/geometry'
import { AppError } from '@/domain/types'
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!))
export function floorplanSVG(project: Project, floor?: number): string {
  const rooms = project.rooms.filter(r => floor === undefined || r.floor === floor).map(r => ({ ...r, polygon: r.polygon.map(p => transformPoint(p, project.scenes.find(s => s.id === r.sceneId)!.transform)) }))
  if (!rooms.length) throw new AppError('Trace and save at least one room before exporting a floor plan.')
  const points = rooms.flatMap(r => r.polygon), xs = points.map(p => p[0]), zs = points.map(p => p[2]), minX = Math.min(...xs) - 0.6, minZ = Math.min(...zs) - 0.6, width = Math.max(...xs) - minX + 0.6, height = Math.max(...zs) - minZ + 0.6
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minZ - 1} ${width} ${height + 2}" role="img" aria-label="${escape(project.name)} approximate floor plan"><rect x="${minX}" y="${minZ - 1}" width="${width}" height="${height + 2}" fill="#fafbf8"/><text x="${minX + .15}" y="${minZ - .35}" font-family="sans-serif" font-size=".28" fill="#163b30">${escape(project.name)} · approximate plan</text>${rooms.map(r => {
    const x = r.polygon.reduce((n, p) => n + p[0], 0) / r.polygon.length, z = r.polygon.reduce((n, p) => n + p[2], 0) / r.polygon.length
    return `<polygon points="${r.polygon.map(p => `${p[0]},${p[2]}`).join(' ')}" fill="#e5efe5" stroke="#276d52" stroke-width=".035"/><text x="${x}" y="${z}" text-anchor="middle" font-family="sans-serif" font-size=".2" fill="#163b30">${escape(r.name)}</text><text x="${x}" y="${z + .3}" text-anchor="middle" font-family="sans-serif" font-size=".17" fill="#426456">≈ ${polygonArea(r.polygon).toFixed(2)} m²</text>`
  }).join('')}<text x="${minX + .15}" y="${minZ + height + .45}" font-family="sans-serif" font-size=".16" fill="#426456">Metres · user-traced / captured outlines · not a survey or construction drawing</text></svg>`
}
