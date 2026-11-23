import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import CentralInvoiceImportPreviewEntry from '~/components/invoice/CentralInvoiceImportPreviewEntry.vue'

const mocks = vi.hoisted(() => ({
  actor: { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'project:list:read', 'supplier:list:read'] },
  authority: null as null | ((problem: { message: string }) => void),
}))
vi.mock('~/lib/read-model/authority', () => ({
  bindReadAuthority: (callback: typeof mocks.authority) => { mocks.authority = callback },
}))
vi.mock('~/lib/invoice/central-bootstrap', () => ({ parseInvoiceSession: (value: unknown) => value }))
vi.mock('~/lib/invoice/central-http', () => ({ createCentralInvoiceHttp: () => ({ previewImport: async () => ({}) }) }))
// 使用合成已核验句柄继续验证身份切换与焦点。
vi.mock('~/lib/invoice/central-workbook-security', () => ({ openVerifiedCentralInvoiceWorkbook: async (file: File) => ({ file, sha256: 'a'.repeat(64), workbook: { sheets: [{ name: '合成票据', sheetKind: 'data', rows: [{}], columns: ['发票号码'] }] }, headers: [{ sheetName: '合成票据', columns: [{ index: 0, rawHeader: '发票号码' }] }] }) }))
vi.mock('~/lib/invoice/central-import-preview', () => ({
  createInvoiceImportCatalogReader: () => async () => ({ catalog: { projects: [], suppliers: [], contracts: [] }, sourceVersions: { projects: 'projects:1', suppliers: 'suppliers:1' } }),
  previewCentralInvoiceWorkbook: async () => ({ rows: [{ source: { sheetName: '合成票据', rowNumber: 2 }, fields: { invoiceNumber: 'PRIVATE-001' }, mappedFields: ['invoiceNumber'], reviewReasons: [], duplicatePreview: { candidates: [] } }], catalog: { projects: [], suppliers: [], contracts: [] } }),
  hasAmbiguousInvoiceColumns: (columns: readonly string[]) => new Set(columns).size !== columns.length,
}))

it('失权隐藏预览，键盘重读保留同身份映射并清除旧结果', async () => {
  vi.stubGlobal('$fetch', async () => structuredClone(mocks.actor))
  await render(CentralInvoiceImportPreviewEntry)
  await page.getByLabelText('选择 Excel 文件').upload(new File(['synthetic'], '合成.xlsx'))
  const field = page.getByLabelText('发票号码的源列')
  await field.selectOptions('发票号码')
  await page.getByRole('button', { name: '读取只读预览' }).click()
  await expect.element(page.getByText('PRIVATE-001')).toBeVisible()
  const region = page.getByRole('region', { name: '发票 Excel 只读预览' }).element()
  ;(field.element() as HTMLElement).focus()
  mocks.authority?.({ message: '访问已变化。' })
  await vi.waitFor(() => expect(region.closest('[inert]')).not.toBeNull())
  expect(getComputedStyle(region).display).toBe('none')
  const retry = page.getByRole('button', { name: '重新读取' })
  await expect.element(retry).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(field).toHaveValue('发票号码')
  await expect.element(page.getByText('PRIVATE-001')).not.toBeInTheDocument()
  await expect.element(field).toHaveFocus()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  vi.unstubAllGlobals()
})
