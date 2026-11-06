import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { fireEvent, render, screen } from '@testing-library/vue'
import { expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import CentralInvoiceQueue from '~/components/invoice/CentralInvoiceQueue.vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'

const confirm = vi.hoisted(() => vi.fn(async () => false))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

const records = [
  { id: 'one', fields: { invoiceNumber: 'ONE', buyer: '甲', totalAmount: 0 }, ocrStatus: 'pending', reviewStatus: 'unreviewed', accountStatus: 'none', printCount: 0 },
  { id: 'two', fields: { invoiceNumber: 'TWO', buyer: '甲', totalAmount: null }, ocrStatus: 'failed', reviewStatus: 'reviewed', accountStatus: 'none', printCount: 0 },
  { id: 'three', fields: { invoiceNumber: 'THREE', buyer: '乙', totalAmount: 12 }, ocrStatus: 'done', reviewStatus: 'reviewed', accountStatus: 'none', printCount: 0 },
] as CentralInvoiceRecord[]

async function setFilter(...labels: string[]) {
  await fireEvent.click(screen.getByRole('button', { name: /筛选发票状态，已选/ }))
  for (const label of labels)
    await fireEvent.click(await screen.findByLabelText(label))
  await fireEvent.click(screen.getByRole('button', { name: '应用' }))
}

it('状态多选按并集与搜索交集筛选，不自动切换选票', async () => {
  const view = render(CentralInvoiceQueue, { props: { records, selectedId: null, projects: [], recognizingId: null } })
  await setFilter('识别失败或部分页面未识别', '待核对')
  expect(screen.getByRole('button', { name: /ONE/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /TWO/ })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /THREE/ })).toBeNull()
  await fireEvent.update(screen.getByLabelText('搜索发票队列'), 'TWO')
  expect(screen.getByRole('button', { name: /TWO/ })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /ONE/ })).toBeNull()
  expect(view.emitted('select')).toBeUndefined()
})

it('正在处理只按会话标识；结束后回到已保存状态', async () => {
  const view = render(CentralInvoiceQueue, { props: { records, selectedId: null, projects: [], recognizingId: 'one' } })
  await setFilter('当前会话正在识别或核对')
  expect(screen.getByRole('button', { name: /ONE/ })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /TWO/ })).toBeNull()
  await view.rerender({ recognizingId: null })
  expect(screen.queryByRole('button', { name: /ONE/ })).toBeNull()
  expect(screen.getByText('当前已读取的发票中没有符合筛选条件的结果。')).toBeTruthy()
})

it('筛选不命中仍保留当前选中项及零值，不触发选票', async () => {
  const view = render(CentralInvoiceQueue, { props: { records, selectedId: 'one', projects: [] } })
  await setFilter('识别完成')
  expect(screen.getByRole('button', { name: /ONE/ }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByText('价税合计 0')).toBeTruthy()
  expect(screen.getByRole('button', { name: /THREE/ })).toBeTruthy()
  expect(screen.getByText('当前选中发票不符合筛选条件，仍保留以便继续处理。')).toBeTruthy()
  expect(view.emitted('select')).toBeUndefined()
})

it('工作台筛选不丢未保存输入，来源失效与换实例清除筛选及打开的草稿', async () => {
  const complete = records.map(record => ({
    ...record,
    version: '1',
    sourceKind: 'manual',
    original: null,
    items: [],
    unrecognizedPageIndexes: [],
    completionMethod: null,
    duplicateStatus: 'normal',
    printRotation: 0,
    ownerKind: null,
    projectId: null,
    supplierId: null,
    contract: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    fields: { ...record.fields, invoiceDate: '', invoiceType: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: null, taxRate: '', remark: '' },
  })) as CentralInvoiceRecord[]
  function makeWorkspace() {
    return { records: shallowRef(complete), loading: shallowRef(false), readState: shallowRef<'ready' | 'loading' | 'unavailable'>('ready'), load: vi.fn(async () => {}), pending: () => null, edit: vi.fn() }
  }
  const first = makeWorkspace()
  const second = makeWorkspace()
  const current = shallowRef(first)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: current.value as never, projects: [], suppliers: [], signatories: [], initialSelectedId: 'one' }) })
  render(Host, { global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  await screen.findByLabelText('购买方')
  await fireEvent.update(screen.getByLabelText('购买方'), '未保存购方')
  await setFilter('识别完成')
  expect(screen.getByRole('button', { name: /ONE/ }).getAttribute('aria-pressed')).toBe('true')
  await fireEvent.click(screen.getByRole('button', { name: /THREE/ }))
  expect(confirm).toHaveBeenCalledOnce()
  expect((screen.getByLabelText('购买方') as HTMLInputElement).value).toBe('未保存购方')
  expect(first.edit).not.toHaveBeenCalled()
  await fireEvent.update(screen.getByLabelText('搜索发票队列'), 'THREE')
  first.readState.value = 'loading'
  await nextTick()
  expect((screen.getByLabelText('搜索发票队列') as HTMLInputElement).value).toBe('THREE')
  expect(document.querySelector('[aria-label="筛选发票状态，已选 1 项"]')).toBeTruthy()
  first.readState.value = 'ready'
  await nextTick()
  await fireEvent.click(screen.getByRole('button', { name: '筛选发票状态，已选 1 项' }))
  first.readState.value = 'unavailable'
  first.readState.value = 'ready'
  await nextTick()
  expect((screen.getByLabelText('搜索发票队列') as HTMLInputElement).value).toBe('')
  expect(screen.getByRole('button', { name: '筛选发票状态，已选 0 项' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '应用' })).toBeNull()
  await setFilter('识别完成')
  await fireEvent.update(screen.getByLabelText('搜索发票队列'), 'THREE')
  current.value = second
  await nextTick()
  expect((screen.getByLabelText('搜索发票队列') as HTMLInputElement).value).toBe('')
  expect(screen.getByRole('button', { name: '筛选发票状态，已选 0 项' })).toBeTruthy()
  expect(second.edit).not.toHaveBeenCalled()
})

it('进行中的票不会误归入等待状态，完成会话后才按原状态显示', async () => {
  const view = render(CentralInvoiceQueue, { props: { records, selectedId: null, projects: [], recognizingId: 'one' } })
  await setFilter('识别尚未完成')
  expect(screen.queryByRole('button', { name: /ONE/ })).toBeNull()
  expect(screen.getByText('当前已读取的发票中没有符合筛选条件的结果。')).toBeTruthy()
  await view.rerender({ recognizingId: null })
  expect(screen.getByRole('button', { name: /ONE/ })).toBeTruthy()
})
