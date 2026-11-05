import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import CentralInvoiceManualCreate from '~/components/invoice/CentralInvoiceManualCreate.vue'

const guards = vi.hoisted(() => ({ leave: null as null | (() => Promise<boolean>), update: null as null | ((to: { fullPath: string }, from: { fullPath: string }) => Promise<boolean> | boolean), confirm: vi.fn(async () => false) }))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: guards.confirm }) }))
vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (fn: typeof guards.leave) => { guards.leave = fn },
  onBeforeRouteUpdate: (fn: typeof guards.update) => { guards.update = fn },
}))

it('手工录入保存为草稿；结果未知时保留输入并使用原编号核对', async () => {
  let pending = false
  const workspace = {
    readState: shallowRef('ready'),
    pendingAll: () => pending ? [{ action: 'manual', targetId: null, commandId: 'original-command' }] : [],
    manual: vi.fn(async () => {
      pending = true
      throw new Error('提交结果未知')
    }),
    recover: vi.fn(async () => {
      pending = false
      return { outcome: 'applied', read: { record: { id: 'invoice-one' } } }
    }),
  }
  const view = render(CentralInvoiceManualCreate, { props: { workspace: workspace as never } })
  await fireEvent.update(screen.getByLabelText('发票号码'), 'TEST-001')
  await fireEvent.update(screen.getByLabelText('税额'), '0')
  await fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
  await screen.findByText('提交结果未知')
  expect(workspace.manual).toHaveBeenCalledWith(expect.objectContaining({ invoiceNumber: 'TEST-001', amount: null, taxAmount: 0 }), [])
  expect((screen.getByLabelText('发票号码') as HTMLInputElement).value).toBe('TEST-001')
  expect(screen.getByLabelText('发票号码').matches(':disabled')).toBe(true)
  expect((screen.getByRole('button', { name: '保存草稿' }) as HTMLButtonElement).disabled).toBe(true)
  await fireEvent.click(screen.getByRole('button', { name: '核对上次提交' }))
  await waitFor(() => expect(view.emitted('saved')).toEqual([['invoice-one']]))
  expect(workspace.recover).toHaveBeenCalledWith(null)
  expect(workspace.manual).toHaveBeenCalledOnce()
})

it('原编号核对为未生效后解锁并保留原输入，再允许重新保存', async () => {
  let pending = false
  const workspace = {
    readState: shallowRef('ready'),
    pendingAll: () => pending ? [{ action: 'manual', targetId: null, commandId: 'original-command' }] : [],
    manual: vi.fn(async () => {
      pending = true
      throw new Error('提交结果未知')
    }),
    recover: vi.fn(async () => {
      pending = false
      return { outcome: 'not-applied', commandId: 'original-command' }
    }),
  }
  render(CentralInvoiceManualCreate, { props: { workspace: workspace as never } })
  await fireEvent.update(screen.getByLabelText('发票号码'), 'TEST-003')
  await fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
  await screen.findByText('提交结果未知')
  expect(screen.getByLabelText('发票号码').matches(':disabled')).toBe(true)
  await fireEvent.click(screen.getByRole('button', { name: '核对上次提交' }))
  await screen.findByText(/上次提交经核对未生效/)
  expect(screen.getByLabelText('发票号码').matches(':disabled')).toBe(false)
  expect((screen.getByLabelText('发票号码') as HTMLInputElement).value).toBe('TEST-003')
  expect((screen.getByRole('button', { name: '保存草稿' }) as HTMLButtonElement).disabled).toBe(false)
  expect(workspace.recover).toHaveBeenCalledWith(null)
  expect(workspace.manual).toHaveBeenCalledOnce()
})

it('不完整金额不会被当作零保存，修正后可继续', async () => {
  const workspace = {
    readState: shallowRef('ready'),
    pendingAll: () => [],
    manual: vi.fn(async () => ({ id: 'invoice-two' })),
  }
  const view = render(CentralInvoiceManualCreate, { props: { workspace: workspace as never } })
  await fireEvent.update(screen.getByLabelText('发票号码'), 'TEST-002')
  await fireEvent.update(screen.getByLabelText('税额'), '-')
  await fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
  expect(screen.getByRole('alert').textContent).toContain('检查金额')
  expect(workspace.manual).not.toHaveBeenCalled()
  expect((screen.getByLabelText('税额') as HTMLInputElement).value).toBe('-')
  await fireEvent.update(screen.getByLabelText('税额'), '0')
  await fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
  await waitFor(() => expect(view.emitted('saved')).toEqual([['invoice-two']]))
  expect(workspace.manual).toHaveBeenCalledWith(expect.objectContaining({ taxAmount: 0, totalAmount: null }), [])
})

it('未保存草稿拒绝离开和切换同路由参数时保留输入', async () => {
  const workspace = { readState: shallowRef('ready'), pendingAll: () => [] }
  render(CentralInvoiceManualCreate, { props: { workspace: workspace as never } })
  await fireEvent.update(screen.getByLabelText('发票号码'), 'PROTECTED-001')
  expect(await guards.leave?.()).toBe(false)
  expect(await guards.update?.({ fullPath: '/finance/invoice/manual-new?invoice=another' }, { fullPath: '/finance/invoice/manual-new' })).toBe(false)
  expect((screen.getByLabelText('发票号码') as HTMLInputElement).value).toBe('PROTECTED-001')
})
