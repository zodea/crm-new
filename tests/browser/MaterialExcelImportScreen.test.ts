import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import MaterialExcelImportScreen from '~/components/contract/MaterialExcelImportScreen.vue'

const mocked = vi.hoisted(() => ({ store: { recoverPending: vi.fn(), preview: vi.fn(), importBatch: vi.fn() } }))
vi.mock('~/stores/material-excel-import', () => ({ useMaterialExcelImportStore: () => mocked.store }))
afterEach(() => vi.unstubAllGlobals())

it('小屏及桌面可键盘核对合同、选择关联，并在表内滚动', async () => {
  vi.stubGlobal('useRuntimeConfig', () => ({ app: { baseURL: '/' } }))
  vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
  const bytes = Uint8Array.from([1, 2, 3])
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
  mocked.store.recoverPending.mockResolvedValue({ applied: 0, notApplied: 0 })
  mocked.store.importBatch.mockResolvedValue(1)
  mocked.store.preview.mockResolvedValue({ fileHash: digest, rows: [{ key: 'G1', rowNumber: 2, draft: { name: '合成采购', no: 'C-1' }, projectName: '合成项目', supplierName: '合成供方', constructionName: '合成施工合同', signatoryName: '', lineItems: [{ materialName: '合成管', unit: '米', qty: 2, taxInclusiveUnitPrice: 10 }], lineCount: 1, fingerprint: 'a'.repeat(64), candidates: [{ id: 'existing', version: '1', name: '合成采购', no: 'OLD-1', fields: { name: '合成采购', no: 'OLD-1' }, lineCount: 1, attachmentCount: 1 }], projects: [{ id: 'project-1', name: '合成项目', version: '1' }], suppliers: [{ id: 'supplier-1', name: '合成供方', version: '1' }], signatories: [], mains: [{ id: 'main-1', projectId: 'project-1', name: '合成施工合同', no: '', basis: 'b'.repeat(64) }] }] })
  await render(MaterialExcelImportScreen)
  const input = page.getByLabelText('选择导入文件').element() as HTMLInputElement
  const data = new DataTransfer()
  data.items.add(new File([bytes], '合成.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  input.files = data.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  const check = page.getByRole('button', { name: '核对工作簿' })
  await expect.element(check).toBeEnabled()
  ;(check.element() as HTMLElement).focus()
  await expect.element(check).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText(/当前无法完整核验所有引用，暂不能批量替换/)).toBeVisible()
  const scroll = page.getByLabelText('已有合同与文件对比').element() as HTMLElement
  expect(getComputedStyle(scroll).overflowX).toBe('auto')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  await page.getByLabelText('第 2 行处理方式').selectOptions('create')
  await page.getByLabelText('第 2 行项目').selectOptions('project-1')
  await page.getByLabelText('第 2 行施工主合同').selectOptions('main-1')
  await page.getByLabelText('第 2 行分供方').selectOptions('supplier-1')
  const submit = page.getByRole('button', { name: '确认并保存整批合同' })
  await expect.element(submit).toBeEnabled()
  ;(submit.element() as HTMLElement).focus()
  await expect.element(submit).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('status')).toHaveTextContent('已保存 1 份采购合同及其来源原件。')
})
