import { afterEach, expect, it, vi } from 'vitest'
import { previewCentralInvoiceWorkbook } from '~/lib/invoice/central-import-preview'
import { openVerifiedCentralInvoiceWorkbook } from '~/lib/invoice/central-workbook-security'

const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('xlsx', async (importOriginal) => {
  const original = await importOriginal<typeof import('xlsx')>()
  return { ...original, read: mocks.read }
})

afterEach(() => vi.unstubAllGlobals())

it.each([
  { name: '合成.xlsx', message: '工作簿安全核验暂不可用', unavailable: true, reads: 0 },
  { name: '合成.xls', message: '旧版 XLS 暂无法安全校验', reads: 0 },
  { name: '合成.csv', message: '请选择 Excel 文件', reads: 0 },
  { name: '伪装.xlsx', message: '工作簿 ZIP', reads: 2 },
])('中央安全入口及公开预览拒绝 $name，禁止解析和访问目录', async ({ name, message, unavailable, reads }) => {
  if (unavailable)
    vi.stubGlobal('crypto', undefined)
  mocks.read.mockClear()
  const file = new File(['synthetic'], name)
  const readFile = vi.spyOn(file, 'arrayBuffer')
  const loadCatalog = vi.fn(async () => {
    throw new Error('不应读取目录')
  })
  const preview = vi.fn(async () => {
    throw new Error('不应查询预览')
  })
  await expect(openVerifiedCentralInvoiceWorkbook(file)).rejects.toThrow(message)
  await expect(previewCentralInvoiceWorkbook({ file, sheetName: '票据', mapping: {}, loadCatalog, preview })).rejects.toThrow(message)
  expect(readFile).toHaveBeenCalledTimes(reads)
  expect(mocks.read).not.toHaveBeenCalled()
  expect(loadCatalog).not.toHaveBeenCalled()
  expect(preview).not.toHaveBeenCalled()
})

it('已取消的检查不读取、解析或访问目录', async () => {
  mocks.read.mockClear()
  const file = new File(['synthetic'], '合成.xlsx')
  const readFile = vi.spyOn(file, 'arrayBuffer')
  const controller = new AbortController()
  controller.abort()
  const loadCatalog = vi.fn(async () => {
    throw new Error('不应读取目录')
  })
  const preview = vi.fn(async () => {
    throw new Error('不应查询预览')
  })
  await expect(openVerifiedCentralInvoiceWorkbook(file, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  await expect(previewCentralInvoiceWorkbook({ file, sheetName: '票据', mapping: {}, loadCatalog, preview, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(readFile).not.toHaveBeenCalled()
  expect(mocks.read).not.toHaveBeenCalled()
  expect(loadCatalog).not.toHaveBeenCalled()
  expect(preview).not.toHaveBeenCalled()
})
