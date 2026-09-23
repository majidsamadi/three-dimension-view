import { describe, expect, it } from 'vitest'
import { VoxelFusion, unprojectDepth } from '@/domain/reconstruction'
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
describe('depth and pose reconstruction',()=>{
 it('unprojects planar depth rather than normalized-ray distance',()=>{expect(unprojectDepth(100,0,2,100,100,0,0,identity)).toEqual([2,0,-2])})
 it('applies column-major camera-to-world pose',()=>{const m=[...identity];m[12]=4;m[13]=3;expect(unprojectDepth(0,100,2,100,100,0,0,m)).toEqual([4,1,-2])})
 it.each([0,-1,NaN,Infinity,16])('rejects missing or invalid depth %s',d=>{expect(unprojectDepth(0,0,d,100,100,0,0,identity)).toBeNull()})
 it('rejects invalid intrinsics or pose',()=>{expect(unprojectDepth(0,0,1,0,100,0,0,identity)).toBeNull();expect(unprojectDepth(0,0,1,100,100,0,0,[])).toBeNull()})
 it('fuses repeated observations in one voxel',()=>{const f=new VoxelFusion(.025,100,100);expect(f.addPoint([0,0,0])).toBe(0);expect(f.addPoint([.01,0,0])).toBe(0);expect(f.vertexCount).toBe(1);expect(f.snapshot().positions[0]).toBeCloseTo(.005)})
 it('bounds new vertices but still updates known voxels',()=>{const f=new VoxelFusion(.025,1,1);f.addPoint([0,0,0]);expect(f.addPoint([1,0,0])).toBe(-1);expect(f.capacityReached).toBe(true);expect(f.addPoint([.01,0,0])).toBe(0);expect(f.vertexCount).toBe(1)})
 it('never stores nonfinite positions or invalid colours',()=>{const f=new VoxelFusion();expect(f.addPoint([NaN,0,0])).toBe(-1);expect(f.addPoint([0,0,0],[2,0,0])).toBe(-1);expect(f.vertexCount).toBe(0)})
 it('creates triangles only between close valid depth observations',()=>{const f=new VoxelFusion();f.integrateGrid(new Float32Array([0,0,-1,.1,0,-1,0,.1,-1,.1,.1,-1]),2,2);expect(f.vertexCount).toBe(4);expect(f.triangleCount).toBe(2)})
 it('does not bridge large depth gaps',()=>{const f=new VoxelFusion();f.integrateGrid(new Float32Array([0,0,-1,.1,0,-5,0,.1,-1,.1,.1,-5]),2,2);expect(f.triangleCount).toBe(0)})
 it('deduplicates triangles across repeated frames',()=>{const f=new VoxelFusion(),grid=new Float32Array([0,0,-1,.1,0,-1,0,.1,-1,.1,.1,-1]);f.integrateGrid(grid,2,2);f.integrateGrid(grid,2,2);expect(f.triangleCount).toBe(2);expect(f.frames).toBe(2)})
 it('respects invalid depth samples',()=>{const f=new VoxelFusion();f.integrateGrid(new Float32Array([NaN,NaN,NaN,.1,0,-1,0,.1,-1,.1,.1,-1]),2,2);expect(f.vertexCount).toBe(3);expect(f.triangleCount).toBe(1)})
 it('bounds the preview separately from full geometry',()=>{const f=new VoxelFusion();for(let i=0;i<100;i++)f.addPoint([i*.1,0,0]);expect(f.preview(5).positions.length).toBeLessThanOrEqual(15);expect(f.snapshot().positions.length).toBe(300)})
})
