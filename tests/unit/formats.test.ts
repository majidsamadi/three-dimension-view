// @vitest-environment node
// File/Blob buffers and the Three.js parser must share the same ArrayBuffer realm.
// The matching real-browser PLY/GLB round trips are covered by Playwright.
import { describe, expect, it } from 'vitest'
import { importModel, validateGLB, exportModel } from '@/services/models'
import { floorplanSVG } from '@/services/floorplan'
import { sampleProject } from '@/domain/sample'
import { decodeGeometry } from '@/domain/geometry'
function glb(doc: object): ArrayBuffer {const json=new TextEncoder().encode(JSON.stringify(doc)),padded=Math.ceil(json.length/4)*4,b=new ArrayBuffer(20+padded),v=new DataView(b);v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,b.byteLength,true);v.setUint32(12,padded,true);v.setUint32(16,0x4e4f534a,true);const bytes=new Uint8Array(b);bytes.fill(32,20);bytes.set(json,20);return b}
describe('bounded model formats',()=>{
 it('accepts self-contained ordinary GLB metadata',()=>{expect(()=>validateGLB(glb({asset:{version:'2.0'},buffers:[{byteLength:0}]}))).not.toThrow()})
 it('rejects external buffer URLs before the loader can request them',()=>{expect(()=>validateGLB(glb({buffers:[{uri:'https://example.invalid/private'}]}))).toThrow(/external/)})
 it('rejects embedded image decoders and unsupported compression',()=>{expect(()=>validateGLB(glb({images:[{}]}))).toThrow(/texture/);expect(()=>validateGLB(glb({extensionsRequired:['KHR_draco_mesh_compression']}))).toThrow(/extension/)})
 it('imports PLY point clouds without fake mesh faces',async()=>{const f=new File(['ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 0 0\n0 1 0\n'],'points.ply');const r=await importModel(f,crypto.randomUUID());expect(r.scene.kind).toBe('points');expect(r.scene.triangleCount).toBe(0);expect((await decodeGeometry(r.asset.blob)).indices.length).toBe(0)})
 it('imports OBJ geometry while ignoring external materials',async()=>{const f=new File(['mtllib https://example.invalid/file.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'],'mesh.obj');const r=await importModel(f,crypto.randomUUID());expect(r.scene.triangleCount).toBe(1);expect(r.scene.source).toBe('import')})
 it('rejects unsupported file types',async()=>{await expect(importModel(new File(['hi'],'bad.html'),crypto.randomUUID())).rejects.toThrow(/Supported/)})
 it('round-trips binary PLY positions and faces',async()=>{const s=sampleProject(),g=await decodeGeometry(s.assets[0].blob),out=await exportModel([{scene:s.project.scenes[0],geometry:g}],'ply'),result=await importModel(new File([out],'scan.ply'),s.project.id),back=await decodeGeometry(result.asset.blob);expect(back.positions).toEqual(g.positions);expect(back.indices).toEqual(g.indices)})
 it('escapes project and room text in SVG exports',()=>{const s=sampleProject();s.project.name='<script>alert(1)</script>';s.project.rooms[0].name='A & B';const svg=floorplanSVG(s.project);expect(svg).not.toContain('<script>');expect(svg).toContain('&lt;script&gt;');expect(svg).toContain('A &amp; B');expect(svg).toContain('24.00 m²')})
 it('applies scene scale to floor plan area',()=>{const s=sampleProject();s.project.scenes[0].transform.scale=2;expect(floorplanSVG(s.project)).toContain('96.00 m²')})
})
