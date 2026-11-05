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
  await fireEvent.click(screen.getByRole('button', { name: /同名项目 · project-two/ }))
  expect(screen.queryByRole('button', { name: 'invoice-one' })).toBeNull()
  expect(screen.getByRole('button', { name: 'invoice-two' })).toBeTruthy()
})

it('公司开销独立显示和筛选，不伪装成缺失项目', async () => {
  const company: CentralInvoiceRecord = { ...invoice('company-invoice', 100, 'unused'), ownerKind: 'company', projectId: null, supplierId: 'supplier-one', contract: { domain: 'company', id: 'company-contract', version: '1' } }
  render(CentralInvoiceLedgerView, { props: { records: [company, invoice('project-invoice', 200, 'project-one')], projects: [{ id: 'project-one', label: '合成项目' }] } })
  expect(screen.getAllByText('公司开销').length).toBeGreaterThan(0)
  await fireEvent.click(screen.getByRole('button', { name: /公司开销/ }))
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
  await fireEvent.click(screen.getByRole('button', { name: /项目一 · project-one/ }))
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

it('表格和卡片共用筛选、跨筛选选择、导出与打印，保留零和未知', async () => {
  const records = [invoice('zero', 0, 'project-one'), invoice('unknown', null, 'project-two')]
  const view = render(CentralInvoiceLedgerView, { props: { records, projects: [{ id: 'project-one', label: '同名项目' }, { id: 'project-two', label: '同名项目' }] } })
  await fireEvent.click(screen.getByLabelText('选择发票 zero'))
  await fireEvent.click(screen.getByRole('button', { name: /同名项目 · project-two/ }))
  await fireEvent.click(screen.getByRole('button', { name: '卡片' }))
  expect(screen.getByRole('button', { name: '卡片' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByText('字段预览，非原件')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'zero' })).toBeNull()
  expect(screen.getByRole('button', { name: 'unknown' })).toBeTruthy()
  await fireEvent.update(screen.getByLabelText('开票开始日期'), '2026-01-02')
  expect(screen.queryByRole('button', { name: 'unknown' })).toBeNull()
  await fireEvent.update(screen.getByLabelText('开票开始日期'), '2026-01-01')
  expect(screen.getByRole('button', { name: 'unknown' })).toBeTruthy()
  await fireEvent.click(screen.getByLabelText('选择发票 unknown'))
  expect(screen.getByText('已选 2 张 · 合计未统计（金额缺失或超出范围）')).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: '导出 Excel' }))
  expect(view.emitted('export')?.[0]?.[0]).toEqual([records[1]])
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  expect(view.emitted('preparePrint')?.[0]?.[0]).toEqual(records)
  await fireEvent.click(screen.getByRole('button', { name: /^全部/ }))
  const zeroCard = screen.getByRole('button', { name: 'zero' }).closest('article')!
  expect(within(zeroCard).getByText('0.00')).toBeTruthy()
  expect((screen.getByLabelText('选择发票 zero') as HTMLInputElement).checked).toBe(true)
  const unknownCard = screen.getByRole('button', { name: 'unknown' }).closest('article')!
  expect(within(unknownCard).getAllByText('未填写').length).toBeGreaterThan(0)
  await fireEvent.click(screen.getByRole('button', { name: '表格' }))
  expect((screen.getByLabelText('选择发票 unknown') as HTMLInputElement).checked).toBe(true)
  expect((screen.getByLabelText('选择发票 zero') as HTMLInputElement).checked).toBe(true)
})

it('卡片沿用打开、更正、删除和处理期间的限制', async () => {
  const record = invoice('card-one', 100, 'project-one')
  const view = render(CentralInvoiceLedgerView, {
    props: { records: [record], projects: [{ id: 'project-one', label: '项目一' }] },
    global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  })
  await fireEvent.click(screen.getByRole('button', { name: '卡片' }))
  await fireEvent.click(screen.getByRole('button', { name: 'card-one' }))
  expect(view.emitted('open')?.[0]).toEqual(['card-one'])
  expect(screen.getByLabelText('更正发票 card-one').getAttribute('href')).toBe('/finance/invoice/correction/card-one')
  await fireEvent.click(screen.getByRole('button', { name: '删除' }))
  expect(view.emitted('discard')?.[0]).toEqual(['card-one'])
  await view.rerender({ busy: true })
  expect((screen.getByLabelText('选择发票 card-one') as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: '删除' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.queryByLabelText('更正发票 card-one')).toBeNull()
})

it('分页在表格和卡片间共享，跨页及跨筛选勾选仍用于打印，导出使用完整筛选结果', async () => {
  const records = Array.from({ length: 43 }, (_, index) => invoice(`ticket-${String(index + 1).padStart(2, '0')}`, index === 20 ? null : index === 0 ? 0 : 100, 'project-one'))
  const view = render(CentralInvoiceLedgerView, { props: { records, projects: [{ id: 'project-one', label: '项目一' }] } })
  expect(screen.getByText('本页 20 条 · 筛选后 43 条 · 已读取归档 43 条')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'ticket-20' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'ticket-21' })).toBeNull()
  await fireEvent.click(screen.getByLabelText('选择发票 ticket-01'))
  await fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  await fireEvent.click(screen.getByLabelText('选择发票 ticket-21'))
  await fireEvent.click(screen.getByRole('button', { name: '卡片' }))
  expect(screen.getByRole('button', { name: 'ticket-21' })).toBeTruthy()
  expect((screen.getByLabelText('选择发票 ticket-21') as HTMLInputElement).checked).toBe(true)
  expect(screen.queryByRole('button', { name: 'ticket-01' })).toBeNull()
  expect(screen.getByText('已选 2 张 · 合计未统计（金额缺失或超出范围）')).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: '导出 Excel' }))
  expect(view.emitted('export')?.[0]?.[0]).toEqual(records)
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  expect(view.emitted('preparePrint')?.[0]?.[0]).toEqual([records[0], records[20]])
  await fireEvent.update(screen.getByLabelText('搜索发票'), 'ticket-4')
  expect(screen.getByText('本页 4 条 · 筛选后 4 条 · 已读取归档 43 条')).toBeTruthy()
  expect(screen.getByRole('button', { name: '第 1 页' }).getAttribute('aria-current')).toBe('page')
  await fireEvent.click(screen.getByRole('button', { name: '导出 Excel' }))
  expect(view.emitted('export')?.[1]?.[0]).toEqual(records.slice(39))
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  expect(view.emitted('preparePrint')?.[1]?.[0]).toEqual([records[0], records[20]])
  await fireEvent.update(screen.getByLabelText('搜索发票'), '')
  await fireEvent.click(screen.getByRole('button', { name: '表格' }))
  expect((screen.getByLabelText('选择发票 ticket-01') as HTMLInputElement).checked).toBe(true)
  await fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect((screen.getByLabelText('选择发票 ticket-21') as HTMLInputElement).checked).toBe(true)
})

it('调整每页条数重置页码，数据缩减后页码回落且不因再次增多而跳回旧页', async () => {
  const records = Array.from({ length: 43 }, (_, index) => invoice(`row-${String(index + 1).padStart(2, '0')}`, 100, 'project-one'))
  const view = render(CentralInvoiceLedgerView, { props: { records, projects: [{ id: 'project-one', label: '项目一' }] } })
  await fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  await fireEvent.update(screen.getByLabelText('每页条数'), '10')
  expect(screen.getByRole('button', { name: '第 1 页' }).getAttribute('aria-current')).toBe('page')
  await fireEvent.click(screen.getByRole('button', { name: '第 3 页' }))
  await fireEvent.click(screen.getByLabelText('选择发票 row-21'))
  await view.rerender({ records: records.slice(0, 12) })
  expect(screen.getByRole('button', { name: '第 2 页' }).getAttribute('aria-current')).toBe('page')
  expect(screen.getByText('本页 2 条 · 筛选后 12 条 · 已读取归档 12 条')).toBeTruthy()
  expect(screen.queryByText(/已选 1 张/)).toBeNull()
  await view.rerender({ records })
  expect(screen.getByRole('button', { name: '第 2 页' }).getAttribute('aria-current')).toBe('page')
  expect(screen.getByRole('button', { name: 'row-11' })).toBeTruthy()
})

it('归属树按稳定 ID 区分同名项目，并区分未归属、缺失项目身份和不可读来源', async () => {
  const records: CentralInvoiceRecord[] = [
    invoice('first', 100, 'project-one'),
    invoice('second', 200, 'project-two'),
    { ...invoice('company', 1, 'unused'), ownerKind: 'company', projectId: null },
    { ...invoice('personal', 1, 'unused'), ownerKind: 'personal', projectId: null },
    { ...invoice('unassigned', 1, 'unused'), ownerKind: null, projectId: null },
    { ...invoice('missing-project', 1, 'unused'), ownerKind: 'project', projectId: null },
    invoice('unavailable-project', 1, 'project-missing'),
    { ...invoice('draft', 1, 'project-one'), accountStatus: 'none' },
    { ...invoice('deleted', 1, 'project-one'), deletedAt: '2026-01-01T00:00:00.000Z' },
  ]
  const projects = [{ id: 'project-one', label: '同名项目' }, { id: 'project-two', label: '同名项目' }]
  const view = render(CentralInvoiceLedgerView, { props: { records, projects, projectsReadable: true } })
  const tree = within(screen.getByRole('navigation', { name: '按归属' }))
  const first = tree.getByRole('button', { name: /同名项目 · project-one/ })
  const second = tree.getByRole('button', { name: /同名项目 · project-two/ })
  expect(first.textContent).toContain('1')
  await fireEvent.click(screen.getByLabelText('选择发票 first'))
  await fireEvent.click(second)
  expect(second.getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: 'second' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'first' })).toBeNull()
  expect(screen.getByText('已选 1 张 · 合计 100.00')).toBeTruthy()
  await fireEvent.click(tree.getByRole('button', { name: /^未归属/ }))
  expect(screen.getByRole('button', { name: 'unassigned' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'missing-project' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'unavailable-project' })).toBeNull()
  await fireEvent.click(tree.getByRole('button', { name: /^项目身份待核实/ }))
  expect(screen.getByRole('button', { name: 'missing-project' })).toBeTruthy()
  await fireEvent.click(tree.getByRole('button', { name: /^项目来源或权限不可用/ }))
  expect(screen.getByRole('button', { name: 'unavailable-project' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'unassigned' })).toBeNull()
  await fireEvent.click(first)
  await view.rerender({ projectsReadable: false })
  expect(tree.queryByRole('button', { name: /同名项目/ })).toBeNull()
  const unavailable = tree.getByRole('button', { name: '项目来源或权限不可用' })
  expect(unavailable.textContent).toBe('项目来源或权限不可用')
  expect(tree.getByRole('button', { name: /^全部/ }).getAttribute('aria-pressed')).toBe('true')
  await fireEvent.click(unavailable)
  expect(screen.getByRole('button', { name: 'first' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'second' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'unavailable-project' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'unassigned' })).toBeNull()
  expect(screen.queryByText('同名项目')).toBeNull()
  expect((screen.getByLabelText('选择发票 first') as HTMLInputElement).checked).toBe(true)
})
