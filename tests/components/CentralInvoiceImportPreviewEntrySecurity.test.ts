import { fireEvent, render, screen } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import CentralInvoiceImportPreviewEntry from '~/components/invoice/CentralInvoiceImportPreviewEntry.vue'

const mocks = vi.hoisted(() => ({ read: vi.fn(), catalog: vi.fn(), preview: vi.fn() }))
vi.mock('xlsx', async (importOriginal) => {
  const original = await importOriginal<typeof import('xlsx')>()
  return { ...original, read: mocks.read }
})
vi.mock('~/lib/read-model/authority', () => ({ bindReadAuthority: vi.fn() }))
vi.mock('~/lib/invoice/central-bootstrap', () => ({ parseInvoiceSession: (value: unknown) => value }))
vi.mock('~/lib/invoice/central-http', () => ({ createCentralInvoiceHttp: () => ({ previewImport: mocks.preview }) }))
vi.mock('~/lib/invoice/central-import-preview', () => ({
  createInvoiceImportCatalogReader: () => mocks.catalog,
  previewCentralInvoiceWorkbook: vi.fn(),
  hasAmbiguousInvoiceColumns: (columns: readonly string[]) => new Set(columns).size !== columns.length,
}))

afterEach(() => vi.unstubAllGlobals())

it('安全核验不可用时入口只核对身份，不读取目录、文件或发起预览', async () => {
  vi.stubGlobal('crypto', undefined)
  const session = { workspaceId: 'synthetic', actorId: 'synthetic', capabilities: ['finance-invoice:read'] }
  const fetcher = vi.fn(async (url: string) => {
    if (url !== '/api/read/business-session')
      throw new Error('不应读取其他来源')
    return session
  })
  vi.stubGlobal('$fetch', fetcher)
  render(CentralInvoiceImportPreviewEntry)
  const input = await screen.findByLabelText('选择 Excel 文件')
  const file = new File(['synthetic'], '合成.xlsx')
  const readFile = vi.fn(async () => new ArrayBuffer(0))
  Object.defineProperty(file, 'arrayBuffer', { value: readFile })
  await fireEvent.change(input, { target: { files: [file] } })
  expect((await screen.findByRole('alert')).textContent).toContain('工作簿安全核验暂不可用')
  expect(fetcher).toHaveBeenCalled()
  expect(fetcher.mock.calls.every(call => call[0] === '/api/read/business-session')).toBe(true)
  expect(readFile).not.toHaveBeenCalled()
  expect(mocks.read).not.toHaveBeenCalled()
  expect(mocks.catalog).not.toHaveBeenCalled()
  expect(mocks.preview).not.toHaveBeenCalled()
})
