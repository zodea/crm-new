import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CentralInvoiceImportPreviewEntry from '~/components/invoice/CentralInvoiceImportPreviewEntry.vue'

const mocks = vi.hoisted(() => ({
  actor: { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'project:list:read', 'supplier:list:read'] },
  authority: null as null | ((problem: { message: string }) => void),
  parse: vi.fn(),
  previewWorkbook: vi.fn(),
  loadCatalog: vi.fn(),
  preview: vi.fn(),
  session: vi.fn(),
}))
vi.mock('~/lib/read-model/authority', () => ({
  bindReadAuthority: (callback: typeof mocks.authority) => { mocks.authority = callback },
}))
vi.mock('~/lib/invoice/central-bootstrap', () => ({ parseInvoiceSession: (value: unknown) => value }))
vi.mock('~/lib/invoice/central-http', () => ({ createCentralInvoiceHttp: () => ({ previewImport: mocks.preview }) }))
vi.mock('~/lib/invoice/central-import-preview', () => ({
  createInvoiceImportCatalogReader: () => mocks.loadCatalog,
  previewCentralInvoiceWorkbook: mocks.previewWorkbook,
  hasAmbiguousInvoiceColumns: (columns: readonly string[]) => new Set(columns).size !== columns.length,
}))
// 合成句柄用于继续验证失权、焦点和迟到结果；生产门禁不提供替身。
vi.mock('~/lib/invoice/central-workbook-security', async () => {
  const { syntheticHeaders } = await import('../helpers/central-invoice-preview-fixture')
  return { openVerifiedCentralInvoiceWorkbook: async (file: File) => {
    const workbook = await mocks.parse(file)
    return { file, sha256: 'a'.repeat(64), workbook, headers: syntheticHeaders(workbook) }
  } }
})

const snapshot = { catalog: { projects: [], suppliers: [], contracts: [] }, sourceVersions: { projects: 'projects:1', suppliers: 'suppliers:1' } }
const result = { rows: [{ source: { sheetName: '合成票据', rowNumber: 2 }, fields: { invoiceNumber: 'PRIVATE-001' }, mappedFields: ['invoiceNumber'], reviewReasons: [], duplicatePreview: { candidates: [] } }], catalog: snapshot.catalog }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}
async function selectAndMap() {
  await fireEvent.change(screen.getByLabelText('选择 Excel 文件'), { target: { files: [new File(['synthetic'], '合成.xlsx')] } })
  await fireEvent.update(await screen.findByLabelText('发票号码的源列'), '发票号码')
}
beforeEach(() => {
  mocks.actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'project:list:read', 'supplier:list:read'] }
  mocks.authority = null
  mocks.parse.mockReset().mockResolvedValue({ sheets: [{ name: '合成票据', sheetKind: 'data', rows: [{}], columns: ['发票号码'] }] })
  mocks.previewWorkbook.mockReset().mockResolvedValue(result)
  mocks.loadCatalog.mockReset().mockResolvedValue(snapshot)
  mocks.preview.mockReset()
  mocks.session.mockReset().mockImplementation(async () => structuredClone(mocks.actor))
  vi.stubGlobal('$fetch', mocks.session)
})
afterEach(() => {
  vi.unstubAllGlobals()
  mocks.authority = null
})

it('失权立即遮蔽已读结果；同身份恢复映射但须重新预览，换身份不继承文件', async () => {
  render(CentralInvoiceImportPreviewEntry)
  await screen.findByRole('region', { name: '发票 Excel 只读预览' })
  await selectAndMap()
  await fireEvent.click(screen.getByRole('button', { name: '读取只读预览' }))
  await screen.findByText('PRIVATE-001')
  mocks.authority?.({ message: '访问已变化。' })
  await waitFor(() => expect(screen.queryByRole('region', { name: '发票 Excel 只读预览' })).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '重新读取' })))
  await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
  await screen.findByRole('region', { name: '发票 Excel 只读预览' })
  expect((screen.getByLabelText('发票号码的源列') as HTMLSelectElement).value).toBe('发票号码')
  expect(screen.queryByText('PRIVATE-001')).toBeNull()
  mocks.authority?.({ message: '身份已变化。' })
  mocks.actor = { ...mocks.actor, actorId: 'actor-two' }
  await waitFor(() => expect(screen.queryByRole('region', { name: '发票 Excel 只读预览' })).toBeNull())
  await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
  await screen.findByRole('region', { name: '发票 Excel 只读预览' })
  expect(screen.queryByLabelText('发票号码的源列')).toBeNull()
  expect(screen.queryByText('PRIVATE-001')).toBeNull()
})

it('解析期间失权保留所选文件，旧解析完成不能覆盖新解析', async () => {
  const old = deferred<unknown>()
  const fresh = deferred<unknown>()
  mocks.parse.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
  render(CentralInvoiceImportPreviewEntry)
  await screen.findByRole('region', { name: '发票 Excel 只读预览' })
  await fireEvent.change(screen.getByLabelText('选择 Excel 文件'), { target: { files: [new File(['synthetic'], '合成.xlsx')] } })
  mocks.authority?.({ message: '访问已变化。' })
  await screen.findByRole('button', { name: '重新读取' })
  await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
  await screen.findByRole('region', { name: '发票 Excel 只读预览' })
  expect(screen.getByText(/已保留所选文件 合成.xlsx/)).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: '重新解析文件' }))
  old.resolve({ sheets: [{ name: '过期工作表', sheetKind: 'data', rows: [{}], columns: ['旧列'] }] })
  await waitFor(() => expect(screen.getByText('正在读取…')).toBeTruthy())
  expect(screen.queryByText(/过期工作表/)).toBeNull()
  fresh.resolve({ sheets: [{ name: '当前工作表', sheetKind: 'data', rows: [{}], columns: ['新列'] }] })
  await screen.findByText(/当前工作表/)
  expect(screen.queryByText(/过期工作表/)).toBeNull()
})

it('旧查重迟到时不能显示旧事实、错误或结束新请求', async () => {
  const old = deferred<typeof result>()
  const fresh = deferred<typeof result>()
  mocks.previewWorkbook.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
  render(CentralInvoiceImportPreviewEntry)
  await screen.findByRole('region', { name: '发票 Excel 只读预览' })
  await selectAndMap()
  await fireEvent.click(screen.getByRole('button', { name: '读取只读预览' }))
  mocks.authority?.({ message: '访问已变化。' })
  await screen.findByRole('button', { name: '重新读取' })
  await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
  await screen.findByRole('region', { name: '发票 Excel 只读预览' })
  await fireEvent.click(screen.getByRole('button', { name: '读取只读预览' }))
  old.reject(new Error('旧请求错误'))
  await waitFor(() => expect(screen.getByText('正在读取…')).toBeTruthy())
  expect(screen.queryByText('旧请求错误')).toBeNull()
  fresh.resolve(result)
  await screen.findByText('PRIVATE-001')
})

it('服务返回 403 时撤下已显示内容并要求重新读取', async () => {
  render(CentralInvoiceImportPreviewEntry)
  await screen.findByRole('region', { name: '发票 Excel 只读预览' })
  await selectAndMap()
  await fireEvent.click(screen.getByRole('button', { name: '读取只读预览' }))
  await screen.findByText('PRIVATE-001')
  mocks.previewWorkbook.mockRejectedValueOnce(Object.assign(new Error('HTTP 403'), { response: { status: 403 } }))
  await fireEvent.click(screen.getByRole('button', { name: '读取只读预览' }))
  await screen.findByRole('button', { name: '重新读取' })
  expect(screen.queryByRole('region', { name: '发票 Excel 只读预览' })).toBeNull()
})

it('重新读取期间保留键盘焦点，失败后可继续从原按钮重试', async () => {
  const retryRead = deferred<typeof mocks.actor>()
  render(CentralInvoiceImportPreviewEntry)
  await screen.findByRole('region', { name: '发票 Excel 只读预览' })
  await selectAndMap()
  mocks.authority?.({ message: '访问已变化。' })
  const retry = await screen.findByRole('button', { name: '重新读取' })
  await waitFor(() => expect(document.activeElement).toBe(retry))
  mocks.session.mockReturnValueOnce(retryRead.promise)
  await fireEvent.click(retry)
  expect(document.activeElement).toBe(retry)
  expect(retry.getAttribute('aria-disabled')).toBe('true')
  expect(screen.getByRole('status').textContent).toContain('正在读取')
  retryRead.reject(new Error('合成身份来源暂不可用'))
  await screen.findByText(/合成身份来源暂不可用/)
  expect(document.activeElement).toBe(retry)
  expect(retry.getAttribute('aria-disabled')).toBe('false')
  await fireEvent.click(retry)
  await screen.findByRole('region', { name: '发票 Excel 只读预览' })
  expect((screen.getByLabelText('发票号码的源列') as HTMLSelectElement).value).toBe('发票号码')
})

it('重新读取中再次失权，旧失败不能覆盖新请求状态或焦点', async () => {
  const old = deferred<typeof mocks.actor>()
  const fresh = deferred<typeof mocks.actor>()
  render(CentralInvoiceImportPreviewEntry)
  await screen.findByRole('region', { name: '发票 Excel 只读预览' })
  await selectAndMap()
  mocks.authority?.({ message: '第一次失权。' })
  const retry = await screen.findByRole('button', { name: '重新读取' })
  mocks.session.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
  await fireEvent.click(retry)
  await waitFor(() => expect(mocks.session.mock.results.some(result => result.value === old.promise)).toBe(true))
  mocks.authority?.({ message: '再次失权。' })
  await waitFor(() => expect(document.activeElement).toBe(retry))
  await fireEvent.click(retry)
  await waitFor(() => expect(mocks.session.mock.results.some(result => result.value === fresh.promise)).toBe(true))
  old.reject(new Error('旧读取迟到'))
  await waitFor(() => expect(retry.getAttribute('aria-disabled')).toBe('true'))
  expect(screen.queryByText('旧读取迟到')).toBeNull()
  expect(document.activeElement).toBe(retry)
  fresh.resolve(structuredClone(mocks.actor))
  await screen.findByRole('region', { name: '发票 Excel 只读预览' })
  expect((screen.getByLabelText('发票号码的源列') as HTMLSelectElement).value).toBe('发票号码')
})

it('查重期间能力发生变化，即使迟到回执仍携带旧权限也不能展示结果', async () => {
  const read = deferred<{ meta: { capabilities: string[] } }>()
  const previousCapabilities = [...mocks.actor.capabilities]
  mocks.preview.mockReturnValueOnce(read.promise)
  mocks.previewWorkbook.mockImplementationOnce(async ({ preview }: { preview: (input: unknown) => Promise<unknown> }) => {
    await preview({ fields: {}, items: [], source: {} })
    return result
  })
  render(CentralInvoiceImportPreviewEntry)
  await screen.findByRole('region', { name: '发票 Excel 只读预览' })
  await selectAndMap()
  await fireEvent.click(screen.getByRole('button', { name: '读取只读预览' }))
  await waitFor(() => expect(mocks.preview).toHaveBeenCalledOnce())
  mocks.actor = { ...mocks.actor, capabilities: ['finance-invoice:read'] }
  read.resolve({ meta: { capabilities: previousCapabilities } })
  await screen.findByRole('button', { name: '重新读取' })
  expect(screen.queryByRole('region', { name: '发票 Excel 只读预览' })).toBeNull()
  expect(screen.queryByText('PRIVATE-001')).toBeNull()
})
