import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { beforeEach, expect, it, vi } from 'vitest'
import { nextTick, shallowRef } from 'vue'
import CentralInvoiceFieldsForm from '~/components/invoice/CentralInvoiceFieldsForm.vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'

const confirm = vi.hoisted(() => vi.fn(async () => true))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

function invoice(id: string, number: string): CentralInvoiceRecord {
  return { id, version: '1', sourceKind: 'scan', fields: { invoiceNumber: number, invoiceDate: '2026-01-01', invoiceType: '', buyer: '原购方', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: 10, taxRate: '', remark: '' }, items: [{ name: '原明细', spec: '', unit: '', quantity: 1, unitPrice: 10, amount: 10, taxRate: '', taxAmount: 0 }], unrecognizedPageIndexes: [], ocrStatus: 'done', completionMethod: 'ocr', reviewStatus: 'reviewed', accountStatus: 'none', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: 'project', projectId: 'project-one', supplierId: null, contract: null, archivedAt: null, original: { id: 'original-one', fileName: '合成.png', fileSize: 3, mimeType: 'image/png', sha256: 'a'.repeat(64) }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
}

beforeEach(() => confirm.mockReset().mockResolvedValue(true))

it('工作台已归档票面可复制和定位，明细不能编辑，原件与更正入口仍可用', async () => {
  const archived = { ...invoice('archived', 'ARCHIVED-1'), accountStatus: 'archived' as const, archivedAt: '2026-01-02T00:00:00.000Z' }
  const workspace = { records: shallowRef([archived]), loading: shallowRef(false), readState: shallowRef('ready'), sourceVersion: shallowRef('invoices:1'), load: vi.fn(async () => {}), pending: vi.fn(() => null), verifiedOriginal: vi.fn(async () => new Blob(['png'], { type: 'image/png' })) }
  render(CentralInvoiceWorkspaceScreen, { props: { workspace: workspace as never, projects: [], suppliers: [], signatories: [] }, global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' }, InvoiceRegionViewer: { props: ['file'], template: '<div>原件预览：{{ file.name }}</div>' } } } })
  const select = await screen.findByRole('button', { name: /ARCHIVED-1/ }) as HTMLButtonElement
  await waitFor(() => expect(select.disabled).toBe(false))
  await fireEvent.click(select)
  const buyer = await screen.findByLabelText('购买方') as HTMLInputElement
  expect(buyer.value).toBe('原购方')
  expect(buyer.readOnly).toBe(true)
  await waitFor(() => expect(buyer.disabled).toBe(false))
  buyer.focus()
  expect(document.activeElement).toBe(buyer)
  expect((screen.getByLabelText('税额') as HTMLInputElement).readOnly).toBe(true)
  await fireEvent.click(screen.getByText('货物明细（1）'))
  expect((screen.getByLabelText('第 1 行名称') as HTMLInputElement).readOnly).toBe(true)
  expect((screen.getByLabelText('第 1 行数量') as HTMLInputElement).readOnly).toBe(true)
  expect((screen.getByRole('button', { name: '删除第 1 行' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: '添加明细' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: '保存修改' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('link', { name: '查看或新建更正单' }) as HTMLAnchorElement).getAttribute('href')).toBe('/finance/invoice/correction/archived')
  await screen.findByText('原件预览：合成.png')
  expect(workspace.verifiedOriginal).toHaveBeenCalledWith(expect.objectContaining({ id: archived.id }))
})

it('编辑时他处归档会锁定但保留未保存输入，拒绝切换后仍保留', async () => {
  const selected = invoice('selected', 'DRAFT-1')
  const other = invoice('other', 'DRAFT-2')
  const workspace = { records: shallowRef([selected, other]), loading: shallowRef(false), readState: shallowRef('ready'), sourceVersion: shallowRef('invoices:1'), load: vi.fn(async () => {}), pending: vi.fn(() => null), verifiedOriginal: vi.fn(async () => new Blob(['png'], { type: 'image/png' })), edit: vi.fn() }
  render(CentralInvoiceWorkspaceScreen, { props: { workspace: workspace as never, projects: [], suppliers: [], signatories: [], initialSelectedId: selected.id }, global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  const buyer = await screen.findByLabelText('购买方') as HTMLInputElement
  await fireEvent.update(buyer, '未保存的购方')
  await fireEvent.click(screen.getByText('货物明细（1）'))
  await fireEvent.update(screen.getByLabelText('第 1 行名称'), '未保存的明细')
  workspace.records.value = [{ ...selected, version: '2', accountStatus: 'archived', archivedAt: '2026-01-02T00:00:00.000Z' }, other]
  await nextTick()
  expect(buyer.value).toBe('未保存的购方')
  expect(buyer.readOnly).toBe(true)
  expect((screen.getByLabelText('第 1 行名称') as HTMLInputElement).value).toBe('未保存的明细')
  expect((screen.getByLabelText('第 1 行名称') as HTMLInputElement).readOnly).toBe(true)
  expect(screen.getByText(/其他位置已更新这张发票/)).toBeTruthy()
  expect((screen.getByRole('button', { name: '保存修改' }) as HTMLButtonElement).disabled).toBe(true)
  confirm.mockResolvedValueOnce(false)
  await fireEvent.click(screen.getByRole('button', { name: /DRAFT-2/ }))
  expect(confirm).toHaveBeenCalledOnce()
  expect((screen.getByLabelText('购买方') as HTMLInputElement).value).toBe('未保存的购方')
  expect(workspace.edit).not.toHaveBeenCalled()
  confirm.mockResolvedValueOnce(true)
  await fireEvent.click(screen.getByRole('button', { name: /DRAFT-2/ }))
  await waitFor(() => expect((screen.getByLabelText('发票号码') as HTMLInputElement).value).toBe('DRAFT-2'))
})

it('更正单继续使用可编辑表单，未归档票也仍能保存', async () => {
  const archived = { ...invoice('archived', 'ARCHIVED-1'), accountStatus: 'archived' as const }
  const form = render(CentralInvoiceFieldsForm, { props: { record: archived, correctionMode: true } })
  const buyer = screen.getByLabelText('购买方') as HTMLInputElement
  expect(buyer.readOnly).toBe(false)
  await fireEvent.update(buyer, '更正购方')
  await fireEvent.click(screen.getByRole('button', { name: '应用票面修改' }))
  expect(form.emitted('save')?.[0]?.[0]).toMatchObject({ fields: { buyer: '更正购方' } })
  form.unmount()
  const draft = render(CentralInvoiceFieldsForm, { props: { record: invoice('draft', 'DRAFT-1') } })
  await fireEvent.update(screen.getByLabelText('购买方'), '草稿购方')
  await fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
  expect(draft.emitted('save')?.[0]?.[0]).toMatchObject({ fields: { buyer: '草稿购方' } })
})
