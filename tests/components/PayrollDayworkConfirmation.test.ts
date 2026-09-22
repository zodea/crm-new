import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PayrollDayworkConfirmDialog from '~/components/payroll/PayrollDayworkConfirmDialog.vue'
import { dayworkForm } from '../helpers/payroll-c2-ui'

const confirm = vi.fn()
const load = vi.fn()
const ack = vi.fn()
const discard = vi.fn()
const pending = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  discard.mockResolvedValue(false)
  pending.mockReturnValue(null)
  ack.mockReturnValue({ changedSinceCommand: false })
  vi.stubGlobal('useDayworkCentralStore', () => ({ confirmDaywork: confirm, loadDayworkForm: load, acknowledgeDaywork: ack, getDayworkPending: pending }))
  vi.stubGlobal('useRoute', () => ({ fullPath: '/subcontract/daywork?origin=real&project=p&month=2026-08' }))
  vi.stubGlobal('useKitUI', () => ({ success: vi.fn(), confirm: discard }))
  vi.stubGlobal('useTabsStore', () => ({ registerCloseGuard: () => () => {} }))
  vi.stubGlobal('useEventListener', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())
function open() {
  const read = dayworkForm()
  read.eligibility = { canConfirm: true, canEdit: true, reasons: [] }
  return mount(PayrollDayworkConfirmDialog, { props: { read, open: true }, attachTo: document.body })
}
it('修改证明后取消关闭，或 KeepAlive 隐藏再显示，仍保同一原格证明输入', async () => {
  const view = open()
  await flushPromises()
  const input = () => document.querySelector<HTMLInputElement>('[aria-label="确认签工证明人"]')!
  input().value = '尚未保存的证明人'
  input().dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
  const close = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '关闭')!
  close.click()
  await flushPromises()
  expect(discard).toHaveBeenCalled()
  expect(view.emitted().close).toBeUndefined()
  await view.setProps({ open: false })
  await view.setProps({ open: true })
  await flushPromises()
  expect(input().value).toBe('尚未保存的证明人')
  view.unmount()
})
it('确认后切走，迟到回执不能在隐藏页面确认冷读、清稿或通知当前目标', async () => {
  let resolve!: (value: { recordId: string }) => void
  confirm.mockReturnValue(new Promise((done) => {
    resolve = done
  }))
  load.mockResolvedValue(dayworkForm())
  const view = open()
  await flushPromises()
  const button = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '确认签工')!
  button.click()
  await flushPromises()
  await view.setProps({ open: false })
  pending.mockReturnValue({ command: { commandId: 'original' }, state: 'awaiting-read' })
  resolve({ recordId: 'r' })
  await flushPromises()
  expect(ack).not.toHaveBeenCalled()
  expect(view.emitted().changed).toBeUndefined()
  expect(view.emitted().close).toBeUndefined()
  view.unmount()
})
it('明确未应用后重新核对当前记录，保留证明人与日期并使用新依据确认', async () => {
  confirm.mockRejectedValue(new Error('来源已变化，本次未应用'))
  const view = open()
  await flushPromises()
  const input = (label: string) => document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
  input('确认签工证明人').value = '本次原证明人'
  input('确认签工证明人').dispatchEvent(new Event('input', { bubbles: true }))
  input('人工确认日期').value = '2026-08-03'
  input('人工确认日期').dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
  const click = (text: string) => {
    const button = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === text)
    expect(button, `可见操作：${text}`).toBeDefined()
    button!.click()
  }
  click('确认签工')
  await flushPromises()
  const next = dayworkForm()
  next.context = { ...next.context, sourceVersion: 'v2' }
  next.eligibility.canConfirm = true
  next.record!.workContent = '另一窗口修改后的施工内容'
  load.mockResolvedValue(next)
  click('按当前记录重新核对证明信息')
  await flushPromises()
  expect(document.body.textContent).toContain('另一窗口修改后的施工内容')
  expect(input('确认签工证明人').value).toBe('本次原证明人')
  expect(input('人工确认日期').value).toBe('2026-08-03')
  click('确认签工')
  await flushPromises()
  expect(confirm.mock.calls[1]![0].context.sourceVersion).toBe('v2')
  expect(confirm.mock.calls[1]![1]).toEqual({ witness: '本次原证明人', confirmedOn: '2026-08-03' })
  view.unmount()
})
