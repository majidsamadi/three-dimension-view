import { beforeEach, describe, expect, it } from 'vitest'
import { db, repository } from '@/data/database'
import { drafts } from '@/data/drafts'
import { sampleProject } from '@/domain/sample'
import { newProject } from '@/domain/types'
beforeEach(async()=>{const d=await db();await d.clear('projects');await d.clear('assets');await d.clear('settings')})
describe('atomic local storage and concurrency',()=>{
 it('creates and reloads a project without a server',async()=>{const p=newProject('Local');await repository.create(p);expect(await repository.get(p.id)).toEqual(p)})
 it('stores sample geometry as real local blobs with explicit sample provenance',async()=>{const s=sampleProject();await repository.create(s.project,s.assets);expect((await repository.get(s.project.id))?.scenes[0].source).toBe('sample');expect((await repository.asset(s.assets[0].id,s.project.id)).blob.size).toBe(s.assets[0].blob.size)})
 it('refuses duplicate project IDs',async()=>{const p=newProject('Local');await repository.create(p);await expect(repository.create(p)).rejects.toThrow(/already exists/)})
 it('rejects stale revisions and preserves the successful edit',async()=>{const p=newProject('Local');await repository.create(p);await repository.save({...p,name:'New name'},1);await expect(repository.save({...p,name:'Stale edit'},1)).rejects.toThrow(/changed/);expect((await repository.get(p.id))?.name).toBe('New name')})
 it('rejects a create with missing geometry atomically',async()=>{const s=sampleProject();await expect(repository.create(s.project)).rejects.toThrow(/incomplete/);expect(await repository.get(s.project.id)).toBeUndefined()})
 it('rejects a create with foreign asset ownership atomically',async()=>{const s=sampleProject();await expect(repository.create(s.project,[{...s.assets[0],projectId:crypto.randomUUID()}])).rejects.toThrow(/ownership/);expect(await repository.get(s.project.id)).toBeUndefined()})
 it('prevents cross-project asset reads',async()=>{const s=sampleProject();await repository.create(s.project,s.assets);await expect(repository.asset(s.assets[0].id,crypto.randomUUID())).rejects.toThrow(/unavailable/)})
 it('prevents a save from attaching another project’s existing blob',async()=>{const a=sampleProject(),b=newProject('Other');await repository.create(a.project,a.assets);await repository.create(b);await expect(repository.save({...b,scenes:a.project.scenes},1)).rejects.toThrow(/different project/);expect((await repository.get(b.id))?.scenes).toHaveLength(0)})
 it('rejects a wrong asset kind',async()=>{const s=sampleProject();await expect(repository.create(s.project,[{...s.assets[0],kind:'photo'}])).rejects.toThrow(/type/)})
 it('removes orphaned geometry after section deletion',async()=>{const s=sampleProject();await repository.create(s.project,s.assets);await repository.save({...s.project,scenes:[],rooms:[],annotations:[],measurements:[]},1);expect(await repository.assets(s.project.id)).toHaveLength(0)})
 it('rejects a stale delete without data loss',async()=>{const p=newProject('Local');await repository.create(p);await repository.save({...p,notes:'new'},1);await expect(repository.remove(p.id,1)).rejects.toThrow(/changed/);expect(await repository.get(p.id)).toBeDefined()})
 it('deletes only this project’s assets',async()=>{const a=sampleProject(),b=sampleProject();await repository.create(a.project,a.assets);await repository.create(b.project,b.assets);await repository.remove(a.project.id,1);expect(await repository.assets(a.project.id)).toHaveLength(0);expect(await repository.assets(b.project.id)).toHaveLength(1)})
 it('retains interrupted scans in separate recovery storage',async()=>{const s=sampleProject(),sessionId=crypto.randomUUID();await drafts.put({sessionId,projectId:s.project.id,source:'webxr-depth',geometry:s.assets[0].blob,capturedAt:new Date().toISOString(),durationMs:1200,warnings:['Interrupted capture']});expect(await drafts.list(s.project.id)).toHaveLength(1);await drafts.removeProject(s.project.id);expect(await drafts.list(s.project.id)).toHaveLength(0)})
})
