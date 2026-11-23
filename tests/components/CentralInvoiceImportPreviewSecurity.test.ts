import { fireEvent, render, screen } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import CentralInvoiceImportPreview from '~/components/invoice/CentralInvoiceImportPreview.vue'

const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('xlsx', async (importOriginal) => {
  const original = await importOriginal<typeof import('xlsx')>()
  return { ...original, read: mocks.read }
})

afterEach(() => vi.unstubAllGlobals())

it.each([
  ['合成.xlsx', '工作簿安全核验暂不可用'],
  ['合成.xls', '旧版 XLS 暂无法安全校验'],
  ['合成.csv', '请选择 Excel 文件'],
  ['伪装.xlsx', '工作簿安全核验暂不可用'],
])('中央文件选择拒绝 %s，保留原件且不读取或解析', async (name, message) => {
  vi.stubGlobal('crypto', undefined)
  mocks.read.mockClear()
  const file = new File(['synthetic'], name)
  const readFile = vi.fn(async () => new ArrayBuffer(0))
  Object.defineProperty(file, 'arrayBuffer', { value: readFile })
  const loadCatalog = vi.fn(async () => {
    throw new Error('不应读取目录')
  })
  const preview = vi.fn(async () => {
    throw new Error('不应查询预览')
  })
  render(CentralInvoiceImportPreview, { props: { loadCatalog, preview } })
  await fireEvent.change(screen.getByLabelText('选择 Excel 文件'), { target: { files: [file] } })
  expect((await screen.findByRole('alert')).textContent).toContain(message)
  expect(screen.queryByLabelText('工作表')).toBeNull()
  expect((screen.getByRole('button', { name: '读取只读预览' }) as HTMLButtonElement).disabled).toBe(true)
  expect(readFile).not.toHaveBeenCalled()
  expect(mocks.read).not.toHaveBeenCalled()
  expect(loadCatalog).not.toHaveBeenCalled()
  expect(preview).not.toHaveBeenCalled()
})
