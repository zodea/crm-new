import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { beforeEach, expect, it, vi } from 'vitest'
import { nextTick, shallowRef } from 'vue'
import CentralInvoiceDuplicateNotice from '~/components/invoice/CentralInvoiceDuplicateNotice.vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'
import CentralInvoiceWorkspaceView from '~/components/invoice/CentralInvoiceWorkspaceView.vue'

const confirm = vi.hoisted(() => vi.fn(async () => true))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

function invoice(id: string, number: string, duplicateStatus: 'normal' | 'duplicate' = 'normal'): CentralInvoiceRecord {
  return { id, version: '1', sourceKind: 'manual', fields: { invoiceNumber: number, invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'pending', completionMethod: null, reviewStatus: 'unreviewed', accountStatus: 'none', duplicateStatus, printCount: 0, printRotation: 0, ownerKind: null, projectId: null, supplierId: null, contract: null, archivedAt: null, original: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
}

beforeEach(() => confirm.mockReset().mockResolvedValue(true))

it('重新识别草稿改了票号但未手工编辑时，提示仍说明候选依据已保存票号', async () => {
  const selected = invoice('selected', 'ABC', 'duplicate')
  const other = invoice('other', 'ABC')
  const draftRecord = { ...selected, fields: { ...selected.fields, invoiceNumber: 'OCR-NEW' } }
  render(CentralInvoiceWorkspaceView, { props: { records: [selected, other], selectedId: selected.id, originalFile: null, originalLoading: false, busy: false, cloudAvailable: false, sourceAvailable: true, projects: [], suppliers: [], signatories: [], draftRecord }, global: { stubs: { NuxtLink: true } } })
  await nextTick()
  expect((screen.getByLabelText(/^发票号码/) as HTMLInputElement).value).toBe('OCR-NEW')
  expect(within(screen.getByRole('region', { name: '同票号候选' })).getByRole('button', { name: /ID：other/ })).toBeTruthy()
  expect(screen.getByText('此处依据已保存票号；未保存修改尚未参与核对。')).toBeTruthy()
})

it('只将当前快照的候选展示为提示，按两种空白口径查找并保留空票号和过期标记', async () => {
  const selected = invoice('selected', '\u00A0ABC\u00A0', 'duplicate')
  const ascii = invoice('ascii', ' ABC ')
  const unicode = invoice('unicode', '\u00A0ABC\u00A0')
  const second = invoice('second', 'ABC', 'duplicate')
  const deleted = { ...invoice('deleted', 'ABC'), deletedAt: '2026-01-02T00:00:00.000Z' }
  const props = { record: selected, records: [selected, ascii, unicode, second, deleted], dirty: false, busy: false }
  const view = render(CentralInvoiceDuplicateNotice, { props })
  const region = screen.getByRole('region', { name: '同票号候选' })
  expect(within(region).getByText(/以提交时复核为准/)).toBeTruthy()
  expect(within(region).getByRole('button', { name: /ID：ascii/ })).toBeTruthy()
  expect(within(region).getByRole('button', { name: /ID：second/ })).toBeTruthy()
  expect(within(region).queryByRole('button', { name: /ID：unicode/ })).toBeNull()
  expect(within(region).queryByRole('button', { name: /ID：deleted/ })).toBeNull()
  await fireEvent.click(within(region).getByRole('button', { name: /ID：ascii/ }))
  expect(view.emitted('select')).toEqual([['ascii']])
  await view.rerender({ ...props, record: invoice('selected', '', 'duplicate'), records: [selected] })
  expect(screen.getByText(/标记可能已过期/)).toBeTruthy()
  expect(within(screen.getByRole('region', { name: '同票号候选' })).queryAllByRole('button')).toHaveLength(0)
  await view.rerender({ ...props, record: invoice('selected', 'NEW'), records: [invoice('selected', 'NEW')] })
  expect(screen.queryByRole('region', { name: '同票号候选' })).toBeNull()
})

it('候选切换使用工作台离开保护，失权时撤下提示，未保存票号始终保留', async () => {
  const selected = invoice('selected', 'ABC', 'duplicate')
  const other = invoice('other', 'ABC')
  const workspace = { records: shallowRef([selected, other]), loading: shallowRef(false), readState: shallowRef('ready'), sourceVersion: shallowRef('invoices:1'), load: vi.fn(async () => {}), pending: vi.fn(() => null) }
  render(CentralInvoiceWorkspaceScreen, { props: { workspace: workspace as never, projects: [], suppliers: [], signatories: [], initialSelectedId: selected.id }, global: { stubs: { NuxtLink: true } } })
  await screen.findByRole('region', { name: '同票号候选' })
  await fireEvent.update(screen.getByLabelText('发票号码'), '未保存新票号')
  expect(screen.getByText('此处依据已保存票号；未保存修改尚未参与核对。')).toBeTruthy()
  confirm.mockResolvedValueOnce(false)
  await fireEvent.click(within(screen.getByRole('region', { name: '同票号候选' })).getByRole('button', { name: /ID：other/ }))
  expect(confirm).toHaveBeenCalledOnce()
  expect((screen.getByLabelText('发票号码') as HTMLInputElement).value).toBe('未保存新票号')
  workspace.readState.value = 'unavailable'
  await nextTick()
  expect(screen.queryByRole('region', { name: '同票号候选', hidden: true })).toBeNull()
  workspace.readState.value = 'ready'
  await nextTick()
  expect((screen.getByLabelText('发票号码') as HTMLInputElement).value).toBe('未保存新票号')
  confirm.mockResolvedValueOnce(true)
  await fireEvent.click(within(screen.getByRole('region', { name: '同票号候选' })).getByRole('button', { name: /ID：other/ }))
  await waitFor(() => expect((screen.getByLabelText('发票号码') as HTMLInputElement).value).toBe('ABC'))
  expect(confirm).toHaveBeenCalledTimes(2)
})
