import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import * as XLSX from 'xlsx'
import CentralInvoiceLedgerScreen from '~/components/invoice/CentralInvoiceLedgerScreen.vue'
import { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
const mocks = vi.hoisted(() => ({ exportFile: vi.fn(async (_options: unknown) => {}) }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {}, exportFile: mocks.exportFile }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))
afterEach(() => {
  mocks.exportFile.mockClear()
})

function invoice(id: string, number: string): CentralInvoiceRecord {
  return {
    id,
    version: '1',
    sourceKind: 'manual',
    fields: { invoiceNumber: number, invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销售方', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: 0, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'pending',
    completionMethod: 'manual',
    reviewStatus: 'reviewed',
    accountStatus: 'archived',
    duplicateStatus: 'normal',
    printCount: 0,
    printRotation: 0,
    ownerKind: 'personal',
    projectId: null,
    supplierId: null,
    contract: null,
    archivedAt: '2026-01-01T00:00:00.000Z',
    original: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
}

function setup(initial: CentralInvoiceRecord[], projectOptions?: {
  projects?: Array<{ id: string, label: string, sourceVersion: string }>
  verifyProjects?: () => Promise<Array<{ id: string, label: string, sourceVersion: string }>>
  missingVersion?: boolean
}) {
  let revision = 1
  let backend = initial
  const actor = { workspaceId: 'synthetic-workspace', actorId: 'synthetic-actor', capabilities: ['finance-invoice:read', 'finance-invoice:write'] }
  const workspace = createCentralInvoiceWorkspace({
    identity: actor,
    context: async () => actor,
    client: { list: async ({ page, pageSize }: { page: number, pageSize: number }) => ({
      items: backend.slice((page - 1) * pageSize, page * pageSize),
      pagination: { total: backend.length },
      sourceVersion: projectOptions?.missingVersion ? null : `read-${revision}`,
      meta: { sources: [{ key: 'invoices', sourceVersion: `invoices:${revision}` }] },
    }) } as never,
    recognizeLocal: vi.fn() as never,
    storage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
  })
  const preview = defineComponent({
    props: ['rows'],
    emits: ['confirm'],
    template: '<div><span>预览 {{ rows.length }} 条</span><button @click="$emit(\'confirm\', {})">确认测试导出</button></div>',
  })
  render(CentralInvoiceLedgerScreen, { props: { workspace, projects: projectOptions?.projects ?? [], verifyProjects: projectOptions?.verifyProjects }, global: { stubs: { InvoiceExportPreview: preview, NuxtLink: true } } })
  return {
    workspace,
    change(rows: CentralInvoiceRecord[]) {
      backend = rows
      revision++
    },
    revoke() {
      actor.capabilities = []
    },
  }
}

it('预览打开后新增匹配票据时不能导出漏掉新票的跨页快照', async () => {
  const initial = Array.from({ length: 21 }, (_, index) => invoice(`invoice-${index}`, `MATCH-${index}`))
  const source = setup(initial)
  const exportButton = await screen.findByRole('button', { name: '导出 Excel' })
  await waitFor(() => expect((exportButton as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.update(screen.getByLabelText('搜索发票'), 'MATCH')
  await fireEvent.click(exportButton)
  expect(screen.getByText('预览 21 条')).toBeTruthy()
  source.change([...initial, invoice('invoice-new', 'MATCH-new')])
  await fireEvent.click(screen.getByRole('button', { name: '确认测试导出' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '确认测试导出' })).toBeNull())
  expect(mocks.exportFile).not.toHaveBeenCalled()
  expect(screen.getByText('发票来源已变化，请重新读取并打开预览。')).toBeTruthy()
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('alert')))
})

it('其他原票变为匹配结果时也不能导出旧筛选快照', async () => {
  const match = invoice('existing-match', 'MATCH-1')
  const other = invoice('existing-other', 'OTHER')
  const source = setup([match, other])
  const exportButton = await screen.findByRole('button', { name: '导出 Excel' })
  await waitFor(() => expect((exportButton as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.update(screen.getByLabelText('搜索发票'), 'MATCH')
  await fireEvent.click(exportButton)
  expect(screen.getByText('预览 1 条')).toBeTruthy()
  source.change([match, { ...other, version: '2', fields: { ...other.fields, invoiceNumber: 'MATCH-2' } }])
  await fireEvent.click(screen.getByRole('button', { name: '确认测试导出' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '确认测试导出' })).toBeNull())
  expect(mocks.exportFile).not.toHaveBeenCalled()
  expect(screen.getByText('发票来源已变化，请重新读取并打开预览。')).toBeTruthy()
})

it('项目目录异步核验期间来源变化，不能静默退出或导出过期快照', async () => {
  const first = { ...invoice('project-invoice', 'MATCH-1'), ownerKind: 'project' as const, projectId: 'synthetic-project' }
  const projects = [{ id: 'synthetic-project', label: '合成项目', sourceVersion: 'projects:1' }]
  let finishProjects!: (rows: typeof projects) => void
  const pendingProjects = new Promise<typeof projects>((resolve) => {
    finishProjects = resolve
  })
  const verifyProjects = vi.fn(() => pendingProjects)
  const source = setup([first], { projects, verifyProjects })
  const exportButton = await screen.findByRole('button', { name: '导出 Excel' })
  await waitFor(() => expect((exportButton as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(exportButton)
  await fireEvent.click(screen.getByRole('button', { name: '确认测试导出' }))
  await waitFor(() => expect(verifyProjects).toHaveBeenCalledOnce())
  source.change([first, invoice('invoice-new', 'MATCH-2')])
  await source.workspace.load()
  finishProjects(projects)
  await waitFor(() => expect(screen.queryByRole('button', { name: '确认测试导出' })).toBeNull())
  expect(mocks.exportFile).not.toHaveBeenCalled()
  expect(screen.getByText('发票来源已变化，请重新读取并打开预览。')).toBeTruthy()
})

it('稳定来源重读后仍可导出跨页全部筛选结果，并保留零与未知', async () => {
  const rows = Array.from({ length: 21 }, (_, index) => invoice(`stable-${index}`, `MATCH-${index}`))
  rows[1] = { ...rows[1]!, fields: { ...rows[1]!.fields, totalAmount: null } }
  setup(rows)
  const exportButton = await screen.findByRole('button', { name: '导出 Excel' })
  await waitFor(() => expect((exportButton as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.update(screen.getByLabelText('搜索发票'), 'MATCH')
  await fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByRole('button', { name: 'MATCH-20' })).toBeTruthy()
  await fireEvent.click(exportButton)
  expect(screen.getByText('预览 21 条')).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: '确认测试导出' }))
  await waitFor(() => expect(mocks.exportFile).toHaveBeenCalledOnce())
  const saved = mocks.exportFile.mock.calls[0]![0] as { data: ArrayBuffer }
  const sheet = XLSX.read(saved.data, { type: 'array' }).Sheets['发票台账']!
  expect(sheet.E3).toMatchObject({ t: 'n', v: 0 })
  expect(sheet.E4?.v ?? null).toBeNull()
  expect(sheet.B23?.v).toBe('MATCH-20')
})

it('读取权限失效时关闭预览并阻止旧快照导出', async () => {
  const source = setup([invoice('permission-invoice', 'MATCH-1')])
  const exportButton = await screen.findByRole('button', { name: '导出 Excel' })
  await waitFor(() => expect((exportButton as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(exportButton)
  source.revoke()
  await fireEvent.click(screen.getByRole('button', { name: '确认测试导出' }))
  await screen.findByText('发票来源或权限已变化，请重新读取。')
  expect(screen.queryByRole('button', { name: '确认测试导出' })).toBeNull()
  expect(mocks.exportFile).not.toHaveBeenCalled()
})

it('预览期间独立重读相同来源不会撤销预览，仍可导出', async () => {
  const source = setup([invoice('stable-invoice', 'MATCH-1')])
  const exportButton = await screen.findByRole('button', { name: '导出 Excel' })
  await waitFor(() => expect((exportButton as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(exportButton)
  expect(screen.getByText('预览 1 条')).toBeTruthy()
  await source.workspace.load()
  expect(screen.getByText('预览 1 条')).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: '确认测试导出' }))
  await waitFor(() => expect(mocks.exportFile).toHaveBeenCalledOnce())
})

it('来源版本不可核验时不能打开预览或导出', async () => {
  setup([invoice('missing-version', 'MATCH-1')], { missingVersion: true })
  const exportButton = await screen.findByRole('button', { name: '导出 Excel' })
  await waitFor(() => expect((exportButton as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(exportButton)
  expect(screen.getByRole('alert').textContent).toContain('发票来源版本无法核验')
  expect(screen.queryByRole('button', { name: '确认测试导出' })).toBeNull()
  expect(mocks.exportFile).not.toHaveBeenCalled()
})
