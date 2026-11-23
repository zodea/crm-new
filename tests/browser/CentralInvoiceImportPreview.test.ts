import type { InvoiceImportPreview } from '~/lib/invoice/central-http'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import * as XLSX from 'xlsx'
import CentralInvoiceImportPreview from '~/components/invoice/CentralInvoiceImportPreview.vue'

it('各视口通过键盘预览并在目录版本变化时撤下结果', async () => {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['发票号码', '发票日期', '销售方', '金额', '税额', '价税合计'],
    ['00000001', '2026-11-01', '合成公司', null, 0, 10],
  ]), '票据')
  const file = new File([XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer], '合成.xlsx')
  let calls = 0
  const loadCatalog = async () => ({
    catalog: { projects: [], suppliers: [], contracts: [] },
    sourceVersions: { projects: 'projects:1', suppliers: `suppliers:${++calls < 4 ? 1 : 2}` },
  })
  const preview = async () => ({ sourceVersion: 'invoices:1', candidates: [] }) as unknown as InvoiceImportPreview
  await render(CentralInvoiceImportPreview, { props: { loadCatalog, preview } })
  await page.getByLabelText('选择 Excel 文件').upload(file)
  const number = page.getByLabelText('发票号码的源列')
  await expect.element(number).toBeVisible()
  await number.selectOptions('发票号码')
  await page.getByLabelText('金额的源列').selectOptions('金额')
  await page.getByLabelText('税额的源列').selectOptions('税额')
  const button = page.getByRole('button', { name: '读取只读预览' })
  ;(button.element() as HTMLElement).focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('票据 · 第 2 行')).toBeVisible()
  await expect.element(page.getByText('未填写')).toBeVisible()
  await expect.element(page.getByText('0', { exact: true })).toBeVisible()
  await expect.element(button).toHaveFocus()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('alert')).toHaveTextContent('目录在预览期间变化')
  await expect.element(page.getByLabelText('预览结果')).not.toBeInTheDocument()
  await expect.element(button).toHaveFocus()
})

it('歧义表头保留文件并阻断查询，可键盘切换正常表和重新选择文件', async () => {
  const book = XLSX.utils.book_new()
  const goodHeaders = ['发票号码', '发票日期', '销售方', '价税合计']
  const goodRow = ['00000001', '2026-11-01', '合成公司', 10]
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    [...goodHeaders, '税额', '税额', '税额_1'],
    [...goodRow, 1, 2, 3],
  ]), '歧义票据')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([goodHeaders, goodRow]), '正常票据')
  const file = new File([XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer], '合成歧义.xlsx')
  const loadCatalog = vi.fn(async () => ({ catalog: { projects: [], suppliers: [], contracts: [] }, sourceVersions: { projects: 'projects:1', suppliers: 'suppliers:1' } }))
  const preview = vi.fn(async () => ({ sourceVersion: 'invoices:1', candidates: [] }) as unknown as InvoiceImportPreview)
  await render(CentralInvoiceImportPreview, { props: { loadCatalog, preview } })
  const input = page.getByLabelText('选择 Excel 文件')
  ;(input.element() as HTMLInputElement).focus()
  await input.upload(file)
  const alert = page.getByRole('alert')
  await expect.element(alert).toHaveTextContent('工作表存在无法区分的列名')
  await expect.element(page.getByText('已选择文件 合成歧义.xlsx。')).toBeVisible()
  await expect.element(input).toHaveFocus()
  await expect.element(page.getByRole('button', { name: '读取只读预览' })).toBeDisabled()
  expect(loadCatalog).not.toHaveBeenCalled()
  expect(preview).not.toHaveBeenCalled()
  const sheets = page.getByLabelText('工作表')
  expect(sheets.element().getAttribute('aria-describedby')).toBe(alert.element().id)
  ;(sheets.element() as HTMLSelectElement).focus()
  await sheets.selectOptions('正常票据')
  await expect.element(sheets).toHaveFocus()
  await expect.element(alert).not.toBeInTheDocument()
  await page.getByLabelText('发票号码的源列').selectOptions('发票号码')
  const button = page.getByRole('button', { name: '读取只读预览' })
  ;(button.element() as HTMLElement).focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('正常票据 · 第 2 行')).toBeVisible()
  ;(sheets.element() as HTMLSelectElement).focus()
  await sheets.selectOptions('歧义票据')
  await expect.element(sheets).toHaveFocus()
  await expect.element(page.getByLabelText('预览结果')).not.toBeInTheDocument()
  await expect.element(page.getByText('已选择文件 合成歧义.xlsx。')).toBeVisible()
  const fixed = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(fixed, XLSX.utils.aoa_to_sheet([goodHeaders, goodRow]), '修正票据')
  await input.upload(new File([XLSX.write(fixed, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer], '合成修正.xlsx'))
  await expect.element(page.getByText('已选择文件 合成修正.xlsx。')).toBeVisible()
  await expect.element(page.getByLabelText('发票号码的源列')).toBeVisible()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
