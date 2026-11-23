import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import CentralInvoiceImportPreview from '~/components/invoice/CentralInvoiceImportPreview.vue'

const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('xlsx', async (importOriginal) => {
  const original = await importOriginal<typeof import('xlsx')>()
  return { ...original, read: mocks.read }
})

it('中央预览在安全核验不可用时保留文件并阻止解析和查询', async () => {
  mocks.read.mockClear()
  const loadCatalog = vi.fn(async () => {
    throw new Error('不应读取目录')
  })
  const preview = vi.fn(async () => {
    throw new Error('不应查询预览')
  })
  await render(CentralInvoiceImportPreview, { props: { loadCatalog, preview } })
  const input = page.getByLabelText('选择 Excel 文件')
  ;(input.element() as HTMLInputElement).focus()
  await input.upload(new File(['synthetic'], '合成.xlsx'))
  await expect.element(page.getByRole('alert')).toHaveTextContent('工作簿安全核验暂不可用')
  await expect.element(page.getByText('已保留所选文件 合成.xlsx。')).toBeVisible()
  await expect.element(input).toHaveFocus()
  await expect.element(page.getByRole('button', { name: '读取只读预览' })).toBeDisabled()
  expect(mocks.read).not.toHaveBeenCalled()
  expect(loadCatalog).not.toHaveBeenCalled()
  expect(preview).not.toHaveBeenCalled()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
})
