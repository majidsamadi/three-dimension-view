import { describe, expect, it } from 'vitest'
import { cropGeometry, decodeGeometry, distance, encodeGeometry, geometryBounds, isSimplePolygon, polygonArea, polygonPerimeter, transformGeometry, transformPoint } from '@/domain/geometry'
import { validateGeometry, validateProject, safeFilename } from '@/domain/validation'
import { IDENTITY_TRANSFORM, newProject, type GeometryData, type Vec3 } from '@/domain/types'
import { History } from '@/domain/history'
const triangle = (): GeometryData => ({ positions: new Float32Array([0,0,0, 1,0,0, 0,0,1]), colors: new Float32Array([1,0,0, 0,1,0, 0,0,1]), indices: new Uint32Array([0,1,2]) })
describe('geometry binary contract', () => {
 it('round-trips exact vertex colours and indices', async () => { const g = triangle(); expect(await decodeGeometry(encodeGeometry(g))).toEqual(g) })
 it('round-trips point clouds without inventing triangles', async () => { const g = triangle(); g.indices = new Uint32Array(); g.colors = new Float32Array(); expect(await decodeGeometry(encodeGeometry(g))).toEqual(g) })
 it('rejects truncated files', async () => { const b = encodeGeometry(triangle()); await expect(decodeGeometry(b.slice(0,b.size-1))).rejects.toThrow(/incomplete|corrupt/) })
 it('rejects invalid magic', async () => { const b = await encodeGeometry(triangle()).arrayBuffer(); new DataView(b).setUint32(0,0,true); await expect(decodeGeometry(new Blob([b]))).rejects.toThrow(/Unsupported/) })
 it('rejects malicious declared budgets before allocating vertex arrays', async () => { const b = await encodeGeometry(triangle()).arrayBuffer(); new DataView(b).setUint32(8,0xffffffff,true); await expect(decodeGeometry(new Blob([b]))).rejects.toThrow(/size/) })
 it.each([NaN, Infinity, -Infinity, 100001])('rejects invalid position %s', v => { const g=triangle(); g.positions[0]=v; expect(()=>validateGeometry(g)).toThrow() })
 it('rejects dangling indices', () => { const g=triangle(); g.indices[0]=3; expect(()=>validateGeometry(g)).toThrow(/missing vertex/) })
 it('rejects non-triangular index arrays', () => { const g=triangle(); g.indices=new Uint32Array([0,1]); expect(()=>validateGeometry(g)).toThrow() })
 it('rejects invalid colour range', () => { const g=triangle(); g.colors[0]=1.1; expect(()=>validateGeometry(g)).toThrow() })
 it('rejects mismatched colours', () => { const g=triangle(); g.colors=new Float32Array([1,0,0]); expect(()=>validateGeometry(g)).toThrow() })
 it('crops vertices and removes incomplete triangles without modifying the source', () => { const g=triangle(); const c=cropGeometry(g,{min:[0,0,0],max:[.5,1,1]}); expect(c.positions.length).toBe(6); expect(c.indices.length).toBe(0); expect(g.positions.length).toBe(9) })
 it('preserves valid triangles in a complete crop', () => { expect(cropGeometry(triangle(),{min:[-1,-1,-1],max:[2,2,2]})).toEqual(triangle()) })
 it('transforms geometry and measurements consistently', () => { const t={...IDENTITY_TRANSFORM(),position:[2,3,4] as Vec3,scale:2}; expect(transformPoint([1,1,1],t)).toEqual([4,5,6]); expect(geometryBounds(transformGeometry(triangle(),t))).toEqual({min:[2,3,4],max:[4,3,6]}); expect(distance([0,0,0],[3,0,4])).toBe(5) })
 it('uses degrees for rotations', () => { const p=transformPoint([1,0,0],{...IDENTITY_TRANSFORM(),rotation:[0,90,0]}); expect(p[0]).toBeCloseTo(0); expect(p[2]).toBeCloseTo(-1) })
})
describe('floor outlines and metadata', () => {
 const square: Vec3[]=[[0,0,0],[4,0,0],[4,0,3],[0,0,3]]
 it('computes area and perimeter',()=>{expect(polygonArea(square)).toBe(12);expect(polygonPerimeter(square)).toBe(14);expect(isSimplePolygon(square)).toBe(true)})
 it('rejects self-crossing polygons',()=>{expect(isSimplePolygon([[0,0,0],[2,0,2],[0,0,2],[2,0,0]])).toBe(false)})
 it('rejects repeated adjacent corners',()=>{expect(isSimplePolygon([...square,square[0]])).toBe(false)})
 it('rejects degenerate polygons',()=>{expect(isSimplePolygon([[0,0,0],[1,0,0],[2,0,0]])).toBe(false)})
 it('validates new private projects',()=>{const p=newProject('My home');expect(validateProject(p).name).toBe('My home');expect(p.scenes).toHaveLength(0)})
 it('rejects unrelated fields and invalid references',()=>{expect(()=>validateProject({...newProject('Home'),admin:true})).toThrow();expect(()=>validateProject({...newProject('Home'),annotations:[{id:crypto.randomUUID(),sceneId:crypto.randomUUID(),position:[0,0,0],label:'Pin',note:''}]})).toThrow(/missing scan/)})
 it('normalizes safe filenames',()=>{expect(safeFilename('../../a<script>')).not.toMatch(/[<>/]/);expect(safeFilename('...')).toBe('space')})
})
describe('bounded editing history',()=>{
 it('supports undo, redo and clears the redo branch on new editing',()=>{const h=new History<{n:number}>(2);h.record({n:1});expect(h.undo({n:2})).toEqual({n:1});expect(h.redo({n:1})).toEqual({n:2});h.record({n:3});expect(h.canRedo).toBe(false)})
 it('retains only the configured number of snapshots',()=>{const h=new History<{n:number}>(2);h.record({n:1});h.record({n:2});h.record({n:3});expect(h.undo({n:4})).toEqual({n:3});expect(h.undo({n:3})).toEqual({n:2});expect(h.undo({n:2})).toBeNull();h.clear();expect(h.canRedo).toBe(false)})
})
