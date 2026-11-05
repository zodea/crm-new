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

it('台账保留缺失金额并以稳定项目 ID 筛选，混选可进入打印核对', async () => {
  const records = [invoice('invoice-one', 100, 'project-one'), invoice('invoice-two', null, 'project-two')]
  const view = render(CentralInvoiceLedgerView, { props: { records, projects: [{ id: 'project-one', label: '同名项目' }, { id: 'project-two', label: '同名项目' }] } })
  expect(screen.getByText('未填写')).toBeTruthy()
  await fireEvent.click(screen.getByLabelText('选择发票 invoice-one'))
  expect(screen.getByText('已选 1 张 · 合计 100.00')).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  expect(view.emitted('preparePrint')?.[0]?.[0]).toMatchObject([{ id: 'invoice-one', version: '1' }])
  await fireEvent.click(screen.getByLabelText('选择发票 invoice-two'))
  expect(screen.getByText('已选 2 张 · 合计未统计（金额缺失或超出范围）')).toBeTruthy()
  expect((screen.getByRole('button', { name: '打印所选' }) as HTMLButtonElement).disabled).toBe(false)
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  expect(view.emitted('preparePrint')?.[1]?.[0]).toMatchObject([{ id: 'invoice-one' }, { id: 'invoice-two', fields: { totalAmount: null } }])
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

it('按开票日期包含边界筛选，与归属、搜索和导出组合，保留跨筛选勾选', async () => {
  const dated = (id: string, date: string, projectId = 'project-one') => {
    const record = invoice(id, 100, projectId)
    return { ...record, fields: { ...record.fields, invoiceDate: date } }
  }
  const records = [dated('before', '2025-12-31'), dated('start', '2026-01-01'), dated('end', '2026-01-31'), dated('after', '2026-02-01'), dated('unknown', ''), dated('other-project', '2026-01-15', 'project-two')]
  const view = render(CentralInvoiceLedgerView, { props: { records, projects: [{ id: 'project-one', label: '项目一' }, { id: 'project-two', label: '项目二' }] } })
  expect(screen.getByRole('button', { name: 'unknown' })).toBeTruthy()
  await fireEvent.click(screen.getByLabelText('选择发票 before'))
  await fireEvent.update(screen.getByLabelText('开票开始日期'), '2026-01-01')
  expect(screen.queryByRole('button', { name: 'before' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'unknown' })).toBeNull()
  expect(screen.getByRole('button', { name: 'start' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'after' })).toBeTruthy()
  await fireEvent.update(screen.getByLabelText('开票结束日期'), '2026-01-31')
  expect(screen.getByRole('button', { name: 'end' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'after' })).toBeNull()
  await fireEvent.update(screen.getByLabelText('归属'), 'project-one')
  expect(screen.queryByRole('button', { name: 'other-project' })).toBeNull()
  await fireEvent.update(screen.getByLabelText('搜索发票'), 'end')
  expect(screen.queryByRole('button', { name: 'start' })).toBeNull()
  await fireEvent.click(screen.getByRole('button', { name: '导出 Excel' }))
  expect(view.emitted('export')?.[0]?.[0]).toEqual([records[2]])
  expect(screen.getByText('已选 1 张 · 合计 100.00')).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  expect(view.emitted('preparePrint')?.[0]?.[0]).toEqual([records[0]])
  await fireEvent.update(screen.getByLabelText('搜索发票'), '')
  await fireEvent.update(screen.getByLabelText('开票开始日期'), '')
  expect(screen.getByRole('button', { name: 'before' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'after' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'unknown' })).toBeNull()
  await fireEvent.update(screen.getByLabelText('开票结束日期'), '')
  expect(screen.getByRole('button', { name: 'unknown' })).toBeTruthy()
  expect((screen.getByLabelText('选择发票 before') as HTMLInputElement).checked).toBe(true)
})

it('日期范围倒置或日期非法时提示并阻止导出，修正后恢复', async () => {
  const view = render(CentralInvoiceLedgerView, { props: { records: [invoice('one', 100, 'project-one')], projects: [{ id: 'project-one', label: '项目一' }] } })
  const start = screen.getByLabelText('开票开始日期') as HTMLInputElement
  const end = screen.getByLabelText('开票结束日期') as HTMLInputElement
  const exportButton = screen.getByRole('button', { name: '导出 Excel' }) as HTMLButtonElement
  await fireEvent.update(start, '2026-02-01')
  await fireEvent.update(end, '2026-01-01')
  expect(screen.getByRole('alert').textContent).toContain('开始日期不能晚于结束日期')
  expect(start.getAttribute('aria-invalid')).toBe('true')
  expect(exportButton.disabled).toBe(true)
  await fireEvent.click(exportButton)
  expect(view.emitted('export')).toBeUndefined()
  await fireEvent.update(start, '2026-01-01')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(exportButton.disabled).toBe(false)
  await fireEvent.update(start, '0001-01-01')
  expect(screen.getByRole('alert').textContent).toContain('请输入有效的开票日期')
  expect(exportButton.disabled).toBe(true)
  await fireEvent.update(start, '')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(exportButton.disabled).toBe(false)
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
