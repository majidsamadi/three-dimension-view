import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import ScanView from '@/views/ScanView.vue'
const harness = vi.hoisted(() => ({ guard: undefined as undefined | (() => Promise<boolean>), resolveStart: undefined as undefined | (() => void), stop: vi.fn(), remove: vi.fn() }))
vi.mock('vue-router', () => ({
 useRoute: () => ({ params:{ id:'11111111-1111-4111-8111-111111111111' } }),
 useRouter: () => ({push:vi.fn()}),
 onBeforeRouteLeave: (guard: () => Promise<boolean>) => {harness.guard=guard},
}))
vi.mock('@/data/database', () => ({ repository:{get:vi.fn(async()=>({id:'11111111-1111-4111-8111-111111111111',name:'Lifecycle test',scenes:[],photos:[],revision:1}))} }))
vi.mock('@/data/drafts', () => ({drafts:{list:vi.fn(async()=>[])}}))
vi.mock('@/services/capabilities', () => ({getCapabilities:vi.fn(async()=>({platform:'ios',xr:false,native:{available:true,support:'supported',source:'arkit-mesh',reason:'Unit-test bridge only'}}))}))
vi.mock('@/scanner/native', () => ({
 nativeScannerAvailable:()=>true,
 readNativeResult:vi.fn(),
 PhoneScanner:{
  getRecoveries:vi.fn(async()=>({results:[]})),
  addListener:vi.fn(async()=>({remove:harness.remove})),
  start:vi.fn(()=>new Promise<void>(resolve=>{harness.resolveStart=resolve})),
  stop:harness.stop,
 },
}))
let wrapper:VueWrapper|undefined
afterEach(()=>{wrapper?.unmount();wrapper=undefined;vi.clearAllMocks();document.body.innerHTML='';document.body.classList.remove('native-capture');document.documentElement.classList.remove('native-capture')})
describe('native capture lifecycle (simulated bridge, not phone qualification)',()=>{
 it('blocks navigation during camera startup and closes capture on unexpected unmount',async()=>{
  harness.stop.mockResolvedValue({});harness.remove.mockResolvedValue(undefined)
  wrapper=mount(ScanView,{attachTo:document.body,global:{stubs:{RouterLink:true,SceneViewer:true,AppIcon:true}}})
  await flushPromises()
  await wrapper.get('.consent-check input').setValue(true)
  const start=wrapper.findAll('button').find(b=>b.text().includes('Start 3D capture'))!
  await start.trigger('click');await flushPromises()
  expect(wrapper.classes()).toContain('live')
  expect(await harness.guard!()).toBe(false)
  expect(harness.stop).not.toHaveBeenCalled()
  harness.resolveStart!();await flushPromises()
  wrapper.unmount();wrapper=undefined;await flushPromises()
  expect(harness.stop).toHaveBeenCalledTimes(1)
  expect(harness.remove).toHaveBeenCalledTimes(1)
  expect(document.body.classList.contains('native-capture')).toBe(false)
 })
})
