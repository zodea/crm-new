import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, reactive, shallowRef } from 'vue'
import { usePayrollDayworkForm } from '~/composables/usePayrollDayworkForm'
import { dayworkForm } from '../helpers/payroll-c2-ui'

const load = vi.fn()
const save = vi.fn()
const ack = vi.fn()
const pending = vi.fn()
const success = vi.fn()
const push = vi.fn()
const route = reactive({ params: { id: 'r' }, path: '/subcontract/daywork/form/r', fullPath: '/subcontract/daywork/form/r?origin=real', query: { origin: 'real' } })
let ui: ReturnType<typeof usePayrollDayworkForm>
const Harness = defineComponent({ setup() {
  ui = usePayrollDayworkForm()
  return () => h('div', [h('input', { value: ui.draft.value.workContent, onInput: (event: Event) => ui.change({ workContent: (event.target as HTMLInputElement).value }) }), h('button', { onClick: () => ui.save('confirmed') }, '保存并确认')])
} })
beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  load.mockResolvedValue(dayworkForm())
  pending.mockReturnValue(null)
  ack.mockReturnValue({ changedSinceCommand: false })
  save.mockImplementation(async () => {
    pending.mockReturnValue({ command: { commandId: 'original' }, state: 'awaiting-read' })
    return { recordId: 'r', status: 'confirmed', outcome: 'saved' }
  })
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ push, replace: vi.fn() }))
  vi.stubGlobal('useDayworkCentralStore', () => ({ loadDayworkForm: load, saveDaywork: save, acknowledgeDaywork: ack, getDayworkPending: pending }))
  vi.stubGlobal('useKitUI', () => ({ success, confirm: vi.fn().mockResolvedValue(false) }))
  vi.stubGlobal('useTabsStore', () => ({ registerCloseGuard: () => () => {} }))
  vi.stubGlobal('useEventListener', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())
it('保存并确认依据实际状态提示，不将 saved 回执误说为待确认', async () => {
  const view = mount(Harness)
  await flushPromises()
  await view.get('button').trigger('click')
  await flushPromises()
  expect(ack).toHaveBeenCalled()
  expect(success).toHaveBeenCalledWith('签工已保存并确认。')
  view.unmount()
})
it('同一原记录后续更新，原键确认后保原输入并提供最新事实，不自动导航覆盖', async () => {
  const view = mount(Harness)
  await flushPromises()
  await view.get('input').setValue('我的原提交')
  ack.mockReturnValue({ changedSinceCommand: true })
  load.mockResolvedValue({ ...dayworkForm(), record: { ...dayworkForm().record!, workContent: '另一窗口后来修改' } })
  await view.get('button').trigger('click')
  await flushPromises()
  expect(ack).toHaveBeenCalled()
  expect(ui.draft.value.workContent).toBe('我的原提交')
  expect(ui.latest.value?.record?.workContent).toBe('另一窗口后来修改')
  expect(ui.changedAfterSave.value).toBe(true)
  expect(push).not.toHaveBeenCalled()
  view.unmount()
})
it('页签自动重读仅更新权限和资格，不抬高原稿保存依据；明确重核后才可提交', async () => {
  const active = shallowRef(true)
  const view = mount(defineComponent({ setup: () => () => h(KeepAlive, () => active.value ? h(Harness) : null) }))
  await flushPromises()
  await view.get('input').setValue('页签中保留的原输入')
  active.value = false
  await flushPromises()
  const refreshed = dayworkForm()
  refreshed.context = { ...refreshed.context, sourceVersion: 'v2' }
  load.mockResolvedValue(refreshed)
  active.value = true
  await flushPromises()
  expect(ui.currentRead.value?.context.sourceVersion).toBe('v2')
  expect(ui.matching.value?.context.sourceVersion).toBe('v1')
  expect(ui.draft.value.workContent).toBe('页签中保留的原输入')
  expect(ui.canSubmit.value).toBe(false)
  await view.get('button').trigger('click')
  expect(save).not.toHaveBeenCalled()
  await ui.load()
  await flushPromises()
  expect(ui.matching.value?.context.sourceVersion).toBe('v2')
  expect(ui.draft.value.workContent).toBe('页签中保留的原输入')
  expect(ui.canSubmit.value).toBe(true)
  active.value = false
  await flushPromises()
  load.mockResolvedValue({ ...refreshed, context: { ...refreshed.context, readonly: true, capabilities: ['payroll:read'] } })
  active.value = true
  await flushPromises()
  expect(ui.editable.value).toBe(false)
  await view.get('button').trigger('click')
  expect(save).not.toHaveBeenCalled()
  expect(ui.draft.value.workContent).toBe('页签中保留的原输入')
  view.unmount()
})
