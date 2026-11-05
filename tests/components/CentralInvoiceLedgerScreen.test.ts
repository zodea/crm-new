import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import { computed, defineComponent, shallowRef, useTemplateRef, watch } from 'vue'
import * as XLSX from 'xlsx'
import CentralInvoiceLedgerScreen from '~/components/invoice/CentralInvoiceLedgerScreen.vue'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
const mocks = vi.hoisted(() => ({ exportFile: vi.fn(async (_options: unknown) => {}) }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {}, exportFile: mocks.exportFile }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  mocks.exportFile.mockClear()
})

it('导出当前筛选且保留未知与零，版本变化时阻止导出', async () => {
  const base: CentralInvoiceRecord = {
    id: 'invoice-one',
    version: '1',
    sourceKind: 'manual',
    fields: { invoiceNumber: '001', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销售方', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'pending',
    completionMethod: 'manual',
    reviewStatus: 'reviewed',
    accountStatus: 'archived',
    duplicateStatus: 'normal',
    printCount: 0,
    printRotation: 0,
    ownerKind: 'personal',
    projectId: null,
    supplierId: null,
    contract: null,
    archivedAt: '2026-01-01T00:00:00.000Z',
    original: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
  const records = shallowRef([base, { ...base, id: 'invoice-two', fields: { ...base.fields, invoiceNumber: '002', totalAmount: 0 } }])
  let changed = false
  const workspace = { records, loading: shallowRef(false), readState: shallowRef('ready'), pendingPrint: () => null, load: vi.fn(async () => {
    if (changed)
      records.value = records.value.map(record => ({ ...record, version: '2' }))
  }) }
  const preview = defineComponent({
    props: ['rows', 'totalAmount', 'error'],
    emits: ['confirm'],
    template: '<div><p>{{ error }}</p><span>{{ totalAmount === null ? "合计未统计" : totalAmount }}</span><button @click="$emit(\'confirm\', {})">确认测试导出</button></div>',
  })
  render(CentralInvoiceLedgerScreen, { props: { workspace: workspace as never, projects: [] }, global: { stubs: { InvoiceExportPreview: preview } } })
  await fireEvent.click(await screen.findByRole('button', { name: '导出 Excel' }))
  expect(screen.getByText('合计未统计')).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: '确认测试导出' }))
  await waitFor(() => expect(mocks.exportFile).toHaveBeenCalledOnce())
  const saved = mocks.exportFile.mock.calls[0]![0] as { data: ArrayBuffer }
  const sheet = XLSX.read(saved.data, { type: 'array' }).Sheets['发票台账']!
  expect(sheet.E3?.v ?? null).toBeNull()
  expect(sheet.E4).toMatchObject({ t: 'n', v: 0 })
  expect(sheet.E5?.v).toContain('未统计')
  await fireEvent.click(screen.getByRole('button', { name: '导出 Excel' }))
  changed = true
  await fireEvent.click(screen.getByRole('button', { name: '确认测试导出' }))
  await screen.findByText('导出预览中的发票已变化，请关闭预览并重新选择。')
  expect(mocks.exportFile).toHaveBeenCalledOnce()
  workspace.load.mockImplementationOnce(async () => {
    workspace.readState.value = 'unavailable'
    throw new Error('发票读取权限已变化')
  })
  await fireEvent.click(screen.getByRole('button', { name: '确认测试导出' }))
  await screen.findByText('发票读取权限已变化')
  expect(screen.queryByRole('button', { name: '确认测试导出' })).toBeNull()
  expect(mocks.exportFile).toHaveBeenCalledOnce()
})

it('导出台账来源与页面一致，旧票缺少来源证据时不猜测', async () => {
  const legacy = { originalState: 'recorded' as const, ambiguousZeroFields: [], ambiguousItemNumbers: false }
  const cases: Array<{ id: string, sourceKind: CentralInvoiceRecord['sourceKind'], legacy?: CentralInvoiceRecord['legacy'], label: string }> = [
    { id: 'scan-invoice', sourceKind: 'scan', label: '扫描' },
    { id: 'excel-invoice', sourceKind: 'excel', label: 'Excel 导入' },
    { id: 'manual-invoice', sourceKind: 'manual', label: '手工录入' },
    { id: 'legacy-scan', sourceKind: 'legacy', legacy: { ...legacy, source: 'scan' }, label: '旧扫描' },
    { id: 'legacy-excel', sourceKind: 'legacy', legacy: { ...legacy, source: 'excel' }, label: '旧 Excel 导入' },
    { id: 'legacy-unknown', sourceKind: 'legacy', label: '来源待核实' },
  ]
  const records = shallowRef<CentralInvoiceRecord[]>(cases.map(({ id, sourceKind, legacy }) => ({
    id,
    version: '1',
    sourceKind,
    legacy,
    fields: { invoiceNumber: id, invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销售方', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: 100, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'done',
    completionMethod: 'ocr',
    reviewStatus: 'reviewed',
    accountStatus: 'archived',
    duplicateStatus: 'normal',
    printCount: 0,
    printRotation: 0,
    ownerKind: 'personal',
    projectId: null,
    supplierId: null,
    contract: null,
    archivedAt: '2026-01-01T00:00:00.000Z',
    original: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  })))
  const workspace = { records, loading: shallowRef(false), readState: shallowRef('ready'), pendingPrint: () => null, load: vi.fn(async () => {}) }
  const preview = defineComponent({ emits: ['confirm'], template: '<button @click="$emit(\'confirm\', {})">确认测试导出</button>' })
  render(CentralInvoiceLedgerScreen, { props: { workspace: workspace as never, projects: [] }, global: { stubs: { InvoiceExportPreview: preview } } })
  await fireEvent.click(await screen.findByRole('button', { name: '导出 Excel' }))
  await fireEvent.click(screen.getByRole('button', { name: '确认测试导出' }))
  await waitFor(() => expect(mocks.exportFile).toHaveBeenCalledOnce())
  const saved = mocks.exportFile.mock.calls[0]![0] as { data: ArrayBuffer }
  const sheet = XLSX.read(saved.data, { type: 'array' }).Sheets['发票台账']!
  cases.forEach(({ id, label }, index) => {
    expect(sheet[`B${index + 3}`]?.v).toBe(id)
    expect(sheet[`G${index + 3}`]?.v).toBe(label)
  })
})

it('项目目录版本变化时不导出旧项目名称', async () => {
  const record = {
    id: 'invoice-project',
    version: '1',
    sourceKind: 'manual',
    fields: { invoiceNumber: '003', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: 10, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'pending',
    completionMethod: 'manual',
    reviewStatus: 'reviewed',
    accountStatus: 'archived',
    duplicateStatus: 'normal',
    printCount: 0,
    printRotation: 0,
    ownerKind: 'project',
    projectId: 'project-one',
    supplierId: null,
    contract: null,
    archivedAt: null,
    original: null,
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
  } as CentralInvoiceRecord
  const workspace = { records: shallowRef([record]), loading: shallowRef(false), readState: shallowRef('ready'), pendingPrint: () => null, load: vi.fn(async () => {}) }
  const verifyProjects = vi.fn().mockResolvedValueOnce([{ id: 'project-one', label: '旧项目名', sourceVersion: 'projects:2' }]).mockResolvedValueOnce([{ id: 'project-one', label: '旧项目名', sourceVersion: 'projects:1' }])
  const preview = defineComponent({ props: ['error'], emits: ['confirm'], template: '<div><p>{{ error }}</p><button @click="$emit(\'confirm\', {})">确认测试导出</button></div>' })
  render(CentralInvoiceLedgerScreen, { props: { workspace: workspace as never, projects: [{ id: 'project-one', label: '旧项目名', sourceVersion: 'projects:1' }], verifyProjects }, global: { stubs: { InvoiceExportPreview: preview } } })
  await fireEvent.click(await screen.findByRole('button', { name: '导出 Excel' }))
  await fireEvent.click(screen.getByRole('button', { name: '确认测试导出' }))
  await screen.findByText('项目目录已变化，请关闭预览并重新读取。')
  expect(mocks.exportFile).not.toHaveBeenCalled()
  await fireEvent.click(screen.getByRole('button', { name: '确认测试导出' }))
  await waitFor(() => expect(mocks.exportFile).toHaveBeenCalledOnce())
  await fireEvent.click(screen.getByRole('button', { name: '导出 Excel' }))
  verifyProjects.mockRejectedValueOnce(new Error('项目读取权限已变化'))
  await fireEvent.click(screen.getByRole('button', { name: '确认测试导出' }))
  await screen.findByText('项目读取权限已变化')
  expect(screen.queryByRole('button', { name: '确认测试导出' })).toBeNull()
  expect(mocks.exportFile).toHaveBeenCalledOnce()
})

it('仅在用户确认已打印后提交原批次，结果未知时核对原任务', async () => {
  for (const [name, value] of Object.entries({ computed, shallowRef, useTemplateRef, watch }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('useEventListener', vi.fn())
  const printed = vi.spyOn(window, 'print').mockImplementation(() => {})
  const record: CentralInvoiceRecord = {
    id: 'invoice-one',
    version: '3',
    sourceKind: 'scan',
    fields: { invoiceNumber: '00123', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销售方', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'done',
    completionMethod: 'ocr',
    reviewStatus: 'reviewed',
    accountStatus: 'archived',
    duplicateStatus: 'normal',
    printCount: 0,
    printRotation: 0,
    ownerKind: 'personal',
    projectId: null,
    supplierId: null,
    contract: null,
    archivedAt: '2026-01-01T00:00:00.000Z',
    original: { id: 'original-one', fileName: '合成.pdf', fileSize: 100, mimeType: 'application/pdf', sha256: 'a'.repeat(64) },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
  let pending = false
  const recordPrinted = vi.fn(async () => {
    pending = true
    throw new Error('回读失败')
  })
  const recoverPrint = vi.fn(async () => {
    pending = false
    return { outcome: 'applied' as const }
  })
  const workspace = { records: shallowRef([record]), loading: shallowRef(false), readState: shallowRef('ready'), load: vi.fn(async () => {}), pendingPrint: () => pending, recordPrinted, recoverPrint }
  render(CentralInvoiceLedgerScreen, { props: { workspace: workspace as never, projects: [] } })
  await fireEvent.click(await screen.findByLabelText('选择发票 00123'))
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  await fireEvent.click(screen.getByRole('button', { name: /打印选中/ }))
  expect(printed).toHaveBeenCalledOnce()
  expect(recordPrinted).not.toHaveBeenCalled()
  await fireEvent.click(screen.getByRole('button', { name: '已打印' }))
  await waitFor(() => expect(recordPrinted).toHaveBeenCalledWith([{ invoiceId: 'invoice-one', baseVersion: '3', rotation: 0 }]))
  await fireEvent.click(await screen.findByRole('button', { name: '核对打印记录' }))
  await waitFor(() => expect(recoverPrint).toHaveBeenCalledOnce())
  expect(recordPrinted).toHaveBeenCalledOnce()
})
