import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
let wrapper: VueWrapper | undefined
function press(key: string, shiftKey = false) {
  document.dispatchEvent(new KeyboardEvent('keydown', {key, shiftKey, bubbles:true, cancelable:true}))
}
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.body.innerHTML = '' })
describe('accessible confirmation and page headings', () => {
  it('focuses the safe action and restores focus after cancel', async () => {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus()
    wrapper = mount(ConfirmDialog, {props:{title:'Delete space?', message:'This removes local data.'}, attachTo:document.body})
    expect(document.activeElement?.textContent).toBe('Cancel')
    press('Escape'); expect(wrapper.emitted('cancel')).toHaveLength(1)
    wrapper.unmount(); wrapper=undefined; expect(document.activeElement).toBe(trigger)
  })
  it('does not cancel a pending write with Escape or a backdrop click', async () => {
    wrapper = mount(ConfirmDialog, {props:{title:'Delete space?', message:'Removing data.', busy:true}, attachTo:document.body})
    press('Escape'); document.querySelector<HTMLElement>('.dialog-backdrop')!.click()
    expect(wrapper.emitted('cancel')).toBeUndefined()
    expect(document.querySelectorAll('button:disabled')).toHaveLength(2)
  })
  it('keeps keyboard focus inside the alert dialog', () => {
    wrapper = mount(ConfirmDialog, {props:{title:'Delete space?', message:'Review first.'}, attachTo:document.body})
    const buttons = document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')
    buttons[0].focus(); press('Tab',true); expect(document.activeElement).toBe(buttons[1])
    press('Tab'); expect(document.activeElement).toBe(buttons[0])
  })
  it('uses a page-level heading only when explicitly selected', () => {
    wrapper=mount(EmptyState,{props:{title:'Not found',message:'Back to your library.',headingTag:'h1'}})
    expect(wrapper.find('h1').text()).toBe('Not found'); expect(wrapper.find('h2').exists()).toBe(false)
  })
})
