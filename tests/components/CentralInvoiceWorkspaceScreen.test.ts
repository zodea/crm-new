import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { expect, it, vi } from 'vitest'
import { nextTick, shallowRef } from 'vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

it('中央工作台选择发票并默认调用本机识别，云端未启用时不能发送', async () => {
  const record: CentralInvoiceRecord = {
    id: 'invoice-one',
    version: '1',
    sourceKind: 'scan',
    fields: { invoiceNumber: '00123', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'pending',
    completionMethod: null,
    reviewStatus: 'unreviewed',
    accountStatus: 'none',
    duplicateStatus: 'normal',
    printCount: 0,
    printRotation: 0,
    ownerKind: null,
    projectId: null,
    supplierId: null,
    contract: null,
    archivedAt: null,
    original: { id: 'original-one', fileName: '合成.pdf', fileSize: 100, mimeType: 'application/pdf', sha256: 'a'.repeat(64) },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
  const recognize = vi.fn(async () => ({ record, candidate: { source: 'local', fields: record.fields, textPages: [], unrecognizedPageIndexes: [], requiresReview: true } }))
  const workspace = {
    records: shallowRef([record]),
    loading: shallowRef(false),
    readState: shallowRef('ready'),
    sourceVersion: shallowRef('version-one'),
    load: vi.fn(async () => {}),
    pending: () => null,
    verifiedOriginal: async () => { throw new Error('合成原件暂不可读') },
    recognizeWithCandidate: recognize,
  }
  render(CentralInvoiceWorkspaceScreen, { props: { workspace: workspace as never, projects: [], suppliers: [], cloudAvailable: false } })
  await fireEvent.click(await screen.findByRole('button', { name: /00123/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: '本机识别' })).toBeTruthy())
  expect((screen.getByRole('button', { name: '云识别' }) as HTMLButtonElement).disabled).toBe(true)
  await fireEvent.click(screen.getByRole('button', { name: '本机识别' }))
  await waitFor(() => expect(recognize).toHaveBeenCalledWith(expect.objectContaining({ id: 'invoice-one' }), 'local', false))
  await fireEvent.update(screen.getByLabelText('购买方'), '未保存的合成购方')
  workspace.readState.value = 'unavailable'
  workspace.records.value = []
  await nextTick()
  expect(screen.queryByRole('textbox', { name: '购买方' })).toBeNull()
  expect(screen.getByText('发票来源尚不可用。')).toBeTruthy()
  workspace.records.value = [record]
  workspace.readState.value = 'ready'
  await nextTick()
  expect((screen.getByLabelText('购买方') as HTMLInputElement).value).toBe('未保存的合成购方')
})

it('手工公司票归档响应丢失后用原编号核对，不重复提交', async () => {
  const record: CentralInvoiceRecord = { id: 'manual-company', version: '1', sourceKind: 'manual', fields: { invoiceNumber: 'MANUAL-COMPANY', invoiceDate: '2026-01-01', invoiceType: '', buyer: '合成购方', buyerTaxNo: 'BUYER', seller: '合成销方', sellerTaxNo: 'SELLER', amount: null, taxAmount: null, totalAmount: 100, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'pending', completionMethod: 'manual', reviewStatus: 'reviewed', accountStatus: 'none', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: null, projectId: null, supplierId: null, contract: null, archivedAt: null, original: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
  const contract = { domain: 'company' as const, id: 'company-one', version: '3', label: '合成公司合同', supplierId: 'supplier-one' }
  let pending = false
  const workspace = {
    records: shallowRef([record]),
    loading: shallowRef(false),
    readState: shallowRef('ready'),
    sourceVersion: shallowRef('invoices:1'),
    load: vi.fn(async () => {}),
    pending: (id: string | null) => pending && id === record.id ? { action: 'archive', commandId: 'original-number' } : null,
    archive: vi.fn(async () => {
      pending = true
      throw new Error('提交结果未知')
    }),
    recover: vi.fn(async () => {
      pending = false
      const current = { ...record, version: '2', accountStatus: 'archived' as const, ownerKind: 'company' as const, supplierId: 'supplier-one', contract: { domain: 'company' as const, id: contract.id, version: contract.version } }
      workspace.records.value = [current]
      return { outcome: 'applied' as const, read: { record: current } }
    }),
  }
  render(CentralInvoiceWorkspaceScreen, { props: { workspace: workspace as never, projects: [], suppliers: [{ id: 'supplier-one', label: '合成分供方', version: '2' }], signatories: [{ id: 'buyer-one', label: '合成购方', version: '1' }], contracts: [contract], cloudAvailable: false }, global: { stubs: { NuxtLink: true } } })
  await fireEvent.click(await screen.findByRole('button', { name: /MANUAL-COMPANY/ }))
  await fireEvent.update(screen.getByLabelText('归属类型'), 'company')
  await fireEvent.update(screen.getByLabelText('我方购买公司'), 'buyer-one')
  await fireEvent.update(screen.getByLabelText('分供方公司'), 'supplier-one')
  await fireEvent.update(screen.getByLabelText('公司支出合同'), JSON.stringify(['company', 'company-one', '3']))
  await fireEvent.click(screen.getByRole('button', { name: '归档发票' }))
  await screen.findByText('提交结果未知')
  expect(workspace.archive).toHaveBeenCalledOnce()
  await fireEvent.click(screen.getByRole('button', { name: '核对上次提交' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '核对上次提交' })).toBeNull())
  expect(workspace.recover).toHaveBeenCalledWith(record.id)
  expect(workspace.archive).toHaveBeenCalledOnce()
  expect(screen.getByText(/发票已归档/)).toBeTruthy()
})
