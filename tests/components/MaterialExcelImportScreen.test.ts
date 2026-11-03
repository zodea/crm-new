import { webcrypto } from 'node:crypto'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import MaterialExcelImportScreen from '~/components/contract/MaterialExcelImportScreen.vue'

const mocked = vi.hoisted(() => ({ store: { recoverPending: vi.fn(), preview: vi.fn(), importBatch: vi.fn() } }))
vi.mock('~/stores/material-excel-import', () => ({ useMaterialExcelImportStore: () => mocked.store }))
afterEach(() => vi.unstubAllGlobals())

it('关联未确认或已有明细冲突不能提交；确认后完整整批发送', async () => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('useRuntimeConfig', () => ({ app: { baseURL: '/' } }))
  vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
  const bytes = Uint8Array.from([1, 2, 3])
  const digest = Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
  mocked.store.recoverPending.mockResolvedValue({ applied: 0, notApplied: 0 })
  mocked.store.importBatch.mockResolvedValue(1)
  mocked.store.preview.mockResolvedValue({ fileHash: digest, rows: [{ key: 'G1', rowNumber: 2, draft: { name: '合成采购', no: 'C-1' }, projectName: '合成项目', supplierName: '合成供方', constructionName: '合成施工合同', signatoryName: '', lineItems: [{ materialName: '合成管', unit: '米', qty: 2, taxInclusiveUnitPrice: 10 }], lineCount: 1, fingerprint: 'a'.repeat(64), candidates: [{ id: 'existing', version: '1', name: '合成采购', no: 'OLD-1', fields: { name: '合成采购', no: 'OLD-1' }, lineCount: 1, attachmentCount: 1 }], projects: [{ id: 'project-1', name: '合成项目', version: '1' }], suppliers: [{ id: 'supplier-1', name: '合成供方', version: '1' }], signatories: [], mains: [{ id: 'main-1', projectId: 'project-1', name: '合成施工合同', no: '', basis: 'b'.repeat(64) }] }] })
  render(MaterialExcelImportScreen)
  const file = new File([bytes], '合成.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer })
  await fireEvent.change(screen.getByLabelText('选择导入文件'), { target: { files: [file] } })
  await waitFor(() => expect((screen.getByRole('button', { name: '核对工作簿' }) as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(screen.getByRole('button', { name: '核对工作簿' }))
  await waitFor(() => expect(screen.getByText('已有明细与文件明细冲突，请在合同页面逐项核对后再导入。')).toBeTruthy())
  expect((screen.getByRole('option', { name: /替换/ }) as HTMLOptionElement).disabled).toBe(true)
  const submit = screen.getByRole('button', { name: '确认并保存整批合同' })
  expect((submit as HTMLButtonElement).disabled).toBe(true)
  await fireEvent.update(screen.getByLabelText('第 2 行处理方式'), 'create')
  await fireEvent.update(screen.getByLabelText('第 2 行项目'), 'project-1')
  await fireEvent.update(screen.getByLabelText('第 2 行施工主合同'), 'main-1')
  await fireEvent.update(screen.getByLabelText('第 2 行分供方'), 'supplier-1')
  expect((submit as HTMLButtonElement).disabled).toBe(false)
  await fireEvent.click(submit)
  expect(mocked.store.importBatch).toHaveBeenCalledOnce()
  expect((await screen.findByRole('status')).textContent).toContain('已保存 1 份采购合同')
})
