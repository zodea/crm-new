import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { expect, it } from 'vitest'
import CentralInvoiceLedgerView from '~/components/invoice/CentralInvoiceLedgerView.vue'

function invoice(id: string, totalAmount: number | null, projectId: string): CentralInvoiceRecord {
  return {
    id,
    version: '1',
    sourceKind: 'scan',
    fields: { invoiceNumber: id, invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销售方', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'done',
    completionMethod: 'ocr',
    reviewStatus: 'reviewed',
    accountStatus: 'archived',
    duplicateStatus: 'normal',
    printCount: 0,
    printRotation: 0,
    ownerKind: 'project',
    projectId,
    supplierId: null,
    contract: null,
    archivedAt: '2026-01-01T00:00:00.000Z',
    original: { id: `original-${id}`, fileName: '合成.pdf', fileSize: 100, mimeType: 'application/pdf', sha256: 'a'.repeat(64) },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
}

it('台账保留缺失金额并以稳定项目 ID 筛选，缺失金额不能进入打印队列', async () => {
  const records = [invoice('invoice-one', 100, 'project-one'), invoice('invoice-two', null, 'project-two')]
  const view = render(CentralInvoiceLedgerView, { props: { records, projects: [{ id: 'project-one', label: '同名项目' }, { id: 'project-two', label: '同名项目' }] } })
  expect(screen.getByText('未填写')).toBeTruthy()
  await fireEvent.click(screen.getByLabelText('选择发票 invoice-one'))
  expect(screen.getByText('已选 1 张 · 合计 100.00')).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  expect(view.emitted('preparePrint')?.[0]?.[0]).toMatchObject([{ id: 'invoice-one', version: '1' }])
  await fireEvent.click(screen.getByLabelText('选择发票 invoice-two'))
  expect(screen.getByText('已选 2 张 · 合计未统计（金额缺失或超出范围）')).toBeTruthy()
  expect((screen.getByRole('button', { name: '打印所选' }) as HTMLButtonElement).disabled).toBe(true)
  await fireEvent.update(screen.getByLabelText('归属'), 'project-two')
  expect(screen.queryByRole('button', { name: 'invoice-one' })).toBeNull()
  expect(screen.getByRole('button', { name: 'invoice-two' })).toBeTruthy()
})

it('公司开销独立显示和筛选，不伪装成缺失项目', async () => {
  const company: CentralInvoiceRecord = { ...invoice('company-invoice', 100, 'unused'), ownerKind: 'company', projectId: null, supplierId: 'supplier-one', contract: { domain: 'company', id: 'company-contract', version: '1' } }
  render(CentralInvoiceLedgerView, { props: { records: [company, invoice('project-invoice', 200, 'project-one')], projects: [{ id: 'project-one', label: '合成项目' }] } })
  expect(screen.getAllByText('公司开销').length).toBeGreaterThan(0)
  await fireEvent.update(screen.getByLabelText('归属'), '__company__')
  expect(screen.getByRole('button', { name: 'company-invoice' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'project-invoice' })).toBeNull()
})

it('按来源证据显示新票与旧票来源，旧票缺少证据时不推断', () => {
  const legacy = { originalState: 'recorded' as const, ambiguousZeroFields: [], ambiguousItemNumbers: false }
  const records: CentralInvoiceRecord[] = [
    invoice('scan-invoice', 100, 'project-one'),
    { ...invoice('excel-invoice', 100, 'project-one'), sourceKind: 'excel', original: null },
    { ...invoice('manual-invoice', 100, 'project-one'), sourceKind: 'manual', original: null },
    { ...invoice('legacy-scan', 100, 'project-one'), sourceKind: 'legacy', legacy: { ...legacy, source: 'scan' } },
    { ...invoice('legacy-excel', 100, 'project-one'), sourceKind: 'legacy', original: null, legacy: { ...legacy, source: 'excel' } },
    { ...invoice('legacy-unknown', 100, 'project-one'), sourceKind: 'legacy', original: null },
  ]
  render(CentralInvoiceLedgerView, { props: { records, projects: [{ id: 'project-one', label: '合成项目' }] } })
  for (const [id, label] of [
    ['scan-invoice', '扫描'],
    ['excel-invoice', 'Excel 导入'],
    ['manual-invoice', '手工录入'],
    ['legacy-scan', '旧扫描'],
    ['legacy-excel', '旧 Excel 导入'],
    ['legacy-unknown', '来源待核实'],
  ] as const) {
    const row = screen.getByRole('button', { name: id }).closest('tr')
    expect(row).not.toBeNull()
    expect(within(row!).getByText(label, { exact: true })).toBeTruthy()
  }
})
