import { describe, expect, it } from 'vitest'
import { archiveIsEncrypted, createArchive, readArchive, remapImportedProject } from '@/domain/archive'
import { sampleProject } from '@/domain/sample'
import { newProject } from '@/domain/types'
describe('portable local project files',()=>{
 it('round-trips all metadata and exact binary geometry',async()=>{const original=sampleProject(),blob=await createArchive(original.project,original.assets),read=await readArchive(blob);expect(read.project).toEqual(original.project);expect(await read.assets[0].blob.arrayBuffer()).toEqual(await original.assets[0].blob.arrayBuffer())})
 it('round-trips an empty organized space',async()=>{const p=newProject('Empty');expect((await readArchive(await createArchive(p,[]))).project).toEqual(p)})
 it('encrypts with a passphrase and opens locally',async()=>{const s=sampleProject(),blob=await createArchive(s.project,s.assets,'a sufficiently long phrase');expect(await archiveIsEncrypted(blob)).toBe(true);expect((await readArchive(blob,'a sufficiently long phrase')).project.id).toBe(s.project.id)})
 it('rejects a wrong or missing passphrase',async()=>{const s=sampleProject(),blob=await createArchive(s.project,s.assets,'a sufficiently long phrase');await expect(readArchive(blob,'wrong passphrase here')).rejects.toThrow(/incorrect|damaged/);await expect(readArchive(blob)).rejects.toThrow(/passphrase/)})
 it('rejects weak passphrases',async()=>{const s=sampleProject();await expect(createArchive(s.project,s.assets,'short')).rejects.toThrow(/12/)})
 it('detects encrypted payload tampering',async()=>{const s=sampleProject(),b=new Uint8Array(await (await createArchive(s.project,s.assets,'a sufficiently long phrase')).arrayBuffer());b[b.length-1]^=1;await expect(readArchive(new Blob([b]),'a sufficiently long phrase')).rejects.toThrow(/incorrect|damaged/)})
 it('detects plaintext geometry checksum tampering',async()=>{const s=sampleProject(),b=new Uint8Array(await (await createArchive(s.project,s.assets)).arrayBuffer());b[b.length-1]^=1;await expect(readArchive(new Blob([b]))).rejects.toThrow(/checksum/)})
 it('rejects extra trailing bytes',async()=>{const s=sampleProject(),b=await createArchive(s.project,s.assets);await expect(readArchive(new Blob([b,'extra']))).rejects.toThrow(/trailing/)})
 it('rejects oversized manifest declarations before parsing',async()=>{const s=sampleProject(),b=await (await createArchive(s.project,s.assets)).arrayBuffer();new DataView(b).setUint32(8,0xffffffff,true);await expect(readArchive(new Blob([b]))).rejects.toThrow(/metadata length/)})
 it('refuses missing and foreign project assets',async()=>{const s=sampleProject();await expect(createArchive(s.project,[])).rejects.toThrow(/missing/);await expect(createArchive(s.project,[{...s.assets[0],projectId:crypto.randomUUID()}])).rejects.toThrow(/missing/)})
 it('remaps every project, scene, annotation, room and asset ID on import',()=>{const s=sampleProject(),copy=remapImportedProject(s.project,s.assets);expect(copy.project.id).not.toBe(s.project.id);expect(copy.assets[0].id).not.toBe(s.assets[0].id);expect(copy.assets[0].projectId).toBe(copy.project.id);expect(copy.project.rooms[0].sceneId).toBe(copy.project.scenes[0].id);expect(copy.project.annotations[0].sceneId).toBe(copy.project.scenes[0].id);expect(s.project.id).not.toBe(copy.project.id)})
})
