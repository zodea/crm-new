import { fireEvent, render, screen } from '@testing-library/vue'
import { beforeEach, expect, it, vi } from 'vitest'
import CentralInvoiceImportPreview from '~/components/invoice/CentralInvoiceImportPreview.vue'

const mocks = vi.hoisted(() => ({ parse: vi.fn(), preview: vi.fn(), headerMode: 'normal' as 'normal' | 'missing' | 'collision' }))
// 只在测试中提供合成的已核验句柄，保留既有映射与显示断言。
vi.mock('~/lib/invoice/central-workbook-security', async () => {
  const { syntheticHeaders } = await import('../helpers/central-invoice-preview-fixture')
  return { openVerifiedCentralInvoiceWorkbook: async (file: File) => {
    const workbook = await mocks.parse(file)
    const headers = syntheticHeaders(workbook)
    if (mocks.headerMode === 'collision') {
      headers[0]!.columns[1]!.rawHeader = ''
      headers[0]!.columns[2]!.rawHeader = '__EMPTY_2'
    }
    return { file, sha256: 'a'.repeat(64), workbook, headers: mocks.headerMode === 'missing' ? undefined : headers }
  } }
})
vi.mock('~/lib/invoice/central-import-preview', () => ({ previewCentralInvoiceWorkbook: mocks.preview, hasAmbiguousInvoiceColumns: (columns: readonly string[]) => new Set(columns).size !== columns.length }))

const snapshot = { catalog: { projects: [{ id: 'project-1', label: '同名项目', version: '1', sourceVersion: 'projects:1' }, { id: 'project-2', label: '同名项目', version: '1', sourceVersion: 'projects:1' }], suppliers: [], contracts: [] }, sourceVersions: { projects: 'projects:1', suppliers: 'suppliers:1' } }
const row = { source: { fileName: '合成.xlsx', fileDigest: 'a'.repeat(64), sheetName: '票据', rowNumber: 4, rawSnapshot: {} }, fields: { invoiceNumber: '00000001', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: 10, taxRate: '', remark: '' }, mappedFields: ['invoiceNumber', 'amount', 'taxAmount'], reviewReasons: [], duplicatePreview: { candidates: [] } }

beforeEach(() => {
  mocks.headerMode = 'normal'
  mocks.parse.mockReset().mockResolvedValue({ sheets: [{ name: '票据', sheetKind: 'data', rows: [{}], columns: ['发票号码', '金额', '税额'] }] })
  mocks.preview.mockReset().mockResolvedValue({ rows: [row], catalog: snapshot.catalog })
})

it.each([
  ['missing', '原始表头证据不可核验'],
  ['collision', '工作表存在无法区分的列名'],
] as const)('表头证据为 %s 时界面阻断映射和目录读取', async (mode, message) => {
  mocks.headerMode = mode
  mocks.parse.mockResolvedValue({ sheets: [{ name: '票据', sheetKind: 'data', rows: [{}], columns: ['发票号码', '__EMPTY_2', '__EMPTY_2_1'] }] })
  const loadCatalog = vi.fn(async () => snapshot)
  const preview = vi.fn()
  render(CentralInvoiceImportPreview, { props: { loadCatalog, preview } })
  await fireEvent.change(screen.getByLabelText('选择 Excel 文件'), { target: { files: [new File(['synthetic'], '合成.xlsx')] } })
  expect((await screen.findByRole('alert')).textContent).toContain(message)
  expect(screen.queryByLabelText('发票号码的源列')).toBeNull()
  expect((screen.getByRole('button', { name: '读取只读预览' }) as HTMLButtonElement).disabled).toBe(true)
  expect(loadCatalog).not.toHaveBeenCalled()
  expect(preview).not.toHaveBeenCalled()
  expect(mocks.preview).not.toHaveBeenCalled()
})

async function selectFile() {
  await fireEvent.change(screen.getByLabelText('选择 Excel 文件'), { target: { files: [new File(['synthetic'], '合成.xlsx')] } })
  await screen.findByLabelText('发票号码的源列')
}

it('明确映射后展示来源行、未知金额与真实零，归属必须人工选择', async () => {
  const loadCatalog = vi.fn(async () => snapshot)
  const preview = vi.fn()
  render(CentralInvoiceImportPreview, { props: { loadCatalog, preview } })
  await selectFile()
  await fireEvent.update(screen.getByLabelText('发票号码的源列'), '发票号码')
  await fireEvent.update(screen.getByLabelText('金额的源列'), '金额')
  await fireEvent.update(screen.getByLabelText('税额的源列'), '税额')
  await fireEvent.click(screen.getByRole('button', { name: '读取只读预览' }))
  expect(await screen.findByText('票据 · 第 4 行')).toBeTruthy()
  expect(screen.getByText(/查重结果基于本次查询时点/)).toBeTruthy()
  expect(screen.getByText('本次查询未发现重复候选。')).toBeTruthy()
  expect(screen.getByText('未填写')).toBeTruthy()
  expect(screen.getByText('0')).toBeTruthy()
  const owner = screen.getByLabelText('第 4 行归属') as HTMLSelectElement
  expect(owner.value).toBe('')
  expect(screen.getByRole('option', { name: '同名项目（project-1）' })).toBeTruthy()
  expect(screen.getByRole('option', { name: '同名项目（project-2）' })).toBeTruthy()
  await fireEvent.update(owner, 'project:project-2')
  expect(owner.value).toBe('project:project-2')
  expect(mocks.preview.mock.calls[0]![0].mapping).toMatchObject({ invoiceNumber: { column: '发票号码', confidence: 'confirmed' } })
  expect(screen.queryByRole('button', { name: /导入|保存|替换/ })).toBeNull()
  await fireEvent.update(screen.getByLabelText('发票号码的源列'), '')
  expect(screen.queryByLabelText('预览结果')).toBeNull()
})

it('读取来源失败时撤下旧结果并显示原因', async () => {
  render(CentralInvoiceImportPreview, { props: { loadCatalog: async () => snapshot, preview: vi.fn() } })
  await selectFile()
  await fireEvent.click(screen.getByRole('button', { name: '读取只读预览' }))
  expect(await screen.findByLabelText('预览结果')).toBeTruthy()
  mocks.preview.mockRejectedValueOnce(new Error('目录来源不可用'))
  await fireEvent.click(screen.getByRole('button', { name: '读取只读预览' }))
  expect((await screen.findByRole('alert')).textContent).toContain('目录来源不可用')
  expect(screen.queryByLabelText('预览结果')).toBeNull()
})

it('歧义列阻断预览并保留文件，可切换其他工作表且焦点不丢失', async () => {
  mocks.parse.mockResolvedValue({ sheets: [
    { name: '歧义票据', sheetKind: 'data', rows: [{}], columns: ['发票号码', '税额_1', '税额_1'] },
    { name: '有效票据', sheetKind: 'data', rows: [{}], columns: ['发票号码', '__importSource'] },
  ] })
  const loadCatalog = vi.fn(async () => snapshot)
  const preview = vi.fn()
  render(CentralInvoiceImportPreview, { props: { loadCatalog, preview } })
  const input = screen.getByLabelText('选择 Excel 文件') as HTMLInputElement
  input.focus()
  await fireEvent.change(input, { target: { files: [new File(['synthetic'], '合成.xlsx')] } })
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('工作表存在无法区分的列名')
  expect(screen.getByText('已选择文件 合成.xlsx。')).toBeTruthy()
  const sheets = screen.getByLabelText('工作表') as HTMLSelectElement
  expect(sheets.getAttribute('aria-describedby')).toBe(alert.id)
  expect(screen.queryByLabelText('发票号码的源列')).toBeNull()
  expect((screen.getByRole('button', { name: '读取只读预览' }) as HTMLButtonElement).disabled).toBe(true)
  expect(mocks.preview).not.toHaveBeenCalled()
  expect(loadCatalog).not.toHaveBeenCalled()
  expect(preview).not.toHaveBeenCalled()
  sheets.focus()
  await fireEvent.update(sheets, '有效票据')
  expect(document.activeElement).toBe(sheets)
  expect(screen.queryByRole('alert')).toBeNull()
  const reserved = screen.getAllByRole('option', { name: '__importSource（不可映射）' })[0] as HTMLOptionElement
  expect(reserved.disabled).toBe(true)
  await fireEvent.click(screen.getByRole('button', { name: '读取只读预览' }))
  expect(await screen.findByLabelText('预览结果')).toBeTruthy()
  sheets.focus()
  await fireEvent.update(sheets, '歧义票据')
  expect(document.activeElement).toBe(sheets)
  expect(screen.queryByLabelText('预览结果')).toBeNull()
  expect(screen.getByText('已选择文件 合成.xlsx。')).toBeTruthy()
})
