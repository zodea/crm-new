import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import * as XLSX from 'xlsx'
import CentralInvoiceEntry from '~/components/invoice/CentralInvoiceEntry.vue'
import CentralInvoiceLedgerScreen from '~/components/invoice/CentralInvoiceLedgerScreen.vue'
import CentralInvoiceLedgerView from '~/components/invoice/CentralInvoiceLedgerView.vue'

const mocks = vi.hoisted(() => ({ catalog: vi.fn(), signatories: vi.fn(), exportFile: vi.fn(), workspace: {}, authority: null as null | ((problem: { message: string }) => void) }))
vi.mock('~/lib/invoice/central-bootstrap', () => ({ parseInvoiceSession: (value: unknown) => value, createInvoiceWorkspaceFromSession: async () => mocks.workspace }))
vi.mock('~/lib/invoice/central-migration-catalog', () => ({ createInvoiceWorkspaceCatalogClient: () => ({ load: mocks.catalog }) }))
vi.mock('~/lib/our-signatory/http-repository', () => ({ createOurSignatoryRepository: () => ({ list: mocks.signatories }) }))
vi.mock('~/lib/read-model/authority', () => ({
  bindReadAuthority: (callback: typeof mocks.authority) => {
    mocks.authority = callback
  },
}))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {}, exportFile: mocks.exportFile }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

beforeEach(() => {
  mocks.exportFile.mockReset().mockResolvedValue(undefined)
  mocks.catalog.mockReset()
  mocks.signatories.mockReset().mockRejectedValue(new Error('不可用'))
  mocks.authority = null
})
afterEach(() => vi.unstubAllGlobals())

const preview = defineComponent({
  props: ['rows', 'error'],
  emits: ['confirm'],
  template: '<div data-testid="preview"><span data-testid="preview-owner">{{ rows[0]?.projectName }}</span><p>{{ error }}</p><button @click="$emit(\'confirm\', {})">确认测试导出</button></div>',
})
const link = defineComponent({ props: ['to'], template: '<a :href="to"><slot /></a>' })
function invoice(ownerKind: 'personal' | 'project' | null): CentralInvoiceRecord {
  return {
    id: 'synthetic-invoice',
    version: '1',
    sourceKind: 'manual',
    fields: { invoiceNumber: 'S-001', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销售方', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: 10, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'pending',
    completionMethod: 'manual',
    reviewStatus: 'reviewed',
    accountStatus: 'archived',
    duplicateStatus: 'normal',
    printCount: 0,
    printRotation: 0,
    ownerKind,
    projectId: ownerKind === 'project' ? 'project-one' : null,
    supplierId: null,
    contract: null,
    archivedAt: '2026-01-01T00:00:00.000Z',
    original: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
}
function workspace(record: CentralInvoiceRecord) {
  return { records: shallowRef([record]), loading: shallowRef(false), readState: shallowRef<'ready' | 'unavailable'>('ready'), sourceVersion: shallowRef('read-1'), pendingPrint: () => null, load: vi.fn(async () => {}) }
}
async function openPreview() {
  const button = await screen.findByRole('button', { name: '导出 Excel' })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.click(button)
  await screen.findByTestId('preview')
}

it('项目目录失败后用户可从台账实际入口重试并恢复', async () => {
  const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'project:list:read'] }
  vi.stubGlobal('useRuntimeConfig', () => ({ app: { baseURL: '/' } }))
  vi.stubGlobal('$fetch', async () => actor)
  let denied = true
  mocks.catalog.mockImplementation(async ([key]: [string]) => {
    if (key === 'projects' && denied)
      throw new Error('项目目录不可读')
    return { projects: key === 'projects' ? [{ id: 'project-one', label: '合成项目', version: '1', sourceVersion: 'projects:1' }] : [], suppliers: [], contracts: [] }
  })
  const stub = defineComponent({ props: ['projects', 'projectsReadable'], template: '<div data-testid="catalog-state">{{ projectsReadable ? projects[0]?.label : "项目不可读" }}</div>' })
  render(CentralInvoiceEntry, { props: { mode: 'ledger' }, global: { stubs: { CentralInvoiceLedgerScreen: stub } } })
  await screen.findByText('项目不可读')
  await fireEvent.click(screen.getByRole('button', { name: '重新读取项目目录' }))
  expect((await screen.findByRole('alert')).textContent).toContain('项目目录不可读')
  denied = false
  await fireEvent.click(screen.getByRole('button', { name: '重新读取项目目录' }))
  await screen.findByText('合成项目')
})

it('真正未归属的票在导出预览中明确显示未归属', async () => {
  const current = workspace(invoice(null))
  render(CentralInvoiceLedgerScreen, { props: { workspace: current as never, projects: [] }, global: { stubs: { InvoiceExportPreview: preview } } })
  await openPreview()
  expect(screen.getByTestId('preview-owner').textContent).toBe('未归属')
  await fireEvent.click(screen.getByRole('button', { name: '确认测试导出' }))
  await waitFor(() => expect(mocks.exportFile).toHaveBeenCalledOnce())
  const saved = mocks.exportFile.mock.calls[0]![0] as { data: ArrayBuffer }
  expect(XLSX.read(saved.data, { type: 'array' }).Sheets['发票台账']?.F3?.v).toBe('未归属')
})

it('项目版本变化后撤下旧导出预览，不能反复确认旧名称', async () => {
  const current = workspace(invoice('project'))
  const projects = [{ id: 'project-one', label: '旧项目', sourceVersion: 'projects:1' }]
  const verifyProjects = vi.fn(async () => [{ id: 'project-one', label: '新项目', sourceVersion: 'projects:2' }])
  render(CentralInvoiceLedgerScreen, { props: { workspace: current as never, projects, verifyProjects }, global: { stubs: { InvoiceExportPreview: preview } } })
  await openPreview()
  expect(screen.getByTestId('preview-owner').textContent).toBe('旧项目')
  await fireEvent.click(screen.getByRole('button', { name: '确认测试导出' }))
  await waitFor(() => expect(screen.queryByTestId('preview')).toBeNull())
  expect(screen.getByRole('alert').textContent).toContain('项目目录已变化')
  expect(mocks.exportFile).not.toHaveBeenCalled()
})

it('项目目录推送变化时立即撤下含旧名称的导出预览', async () => {
  const current = workspace(invoice('project'))
  const projects = [{ id: 'project-one', label: '旧项目', sourceVersion: 'projects:1' }]
  const rendered = render(CentralInvoiceLedgerScreen, { props: { workspace: current as never, projects }, global: { stubs: { InvoiceExportPreview: preview } } })
  await openPreview()
  await rendered.rerender({ projects: [{ id: 'project-one', label: '新项目', sourceVersion: 'projects:2' }] })
  expect(screen.queryByTestId('preview')).toBeNull()
  expect(screen.getByRole('alert').textContent).toContain('项目目录已变化')
  expect(mocks.exportFile).not.toHaveBeenCalled()
})

for (const action of ['unmount', 'switch'] as const) {
  it(`导出重读期间 ${action} 后迟到结果不能输出`, async () => {
    const current = workspace(invoice('personal'))
    const selected = shallowRef(current)
    let release!: () => void
    current.load.mockImplementationOnce(async () => {}).mockImplementationOnce(() => new Promise<void>((resolve) => {
      release = resolve
    }))
    const parent = defineComponent({ setup: () => () => h(CentralInvoiceLedgerScreen, { workspace: selected.value as never, projects: [] }) })
    const global = { stubs: { InvoiceExportPreview: preview, NuxtLink: link } }
    const rendered = action === 'switch'
      ? render(parent, { global })
      : render(CentralInvoiceLedgerScreen, { props: { workspace: current as never, projects: [] }, global })
    await openPreview()
    await fireEvent.click(screen.getByRole('button', { name: '确认测试导出' }))
    await waitFor(() => expect(current.load).toHaveBeenCalledTimes(2))
    if (action === 'unmount') {
      rendered.unmount()
    }
    else {
      selected.value = workspace(invoice('personal'))
      await nextTick()
      expect(screen.queryByTestId('preview')).toBeNull()
      expect(screen.getByRole('alert').textContent).toContain('发票来源或权限已变化')
    }
    release()
    await flushPromises()
    expect(mocks.exportFile).not.toHaveBeenCalled()
  })
}

for (const action of ['unmount', 'switch'] as const) {
  it(`项目校验期间 ${action} 后迟到结果不能输出`, async () => {
    const current = workspace(invoice('project'))
    const selected = shallowRef(current)
    const projects = [{ id: 'project-one', label: '项目', sourceVersion: 'projects:1' }]
    let release!: (value: typeof projects) => void
    const verifyProjects = vi.fn(() => new Promise<typeof projects>((resolve) => {
      release = resolve
    }))
    const parent = defineComponent({ setup: () => () => h(CentralInvoiceLedgerScreen, { workspace: selected.value as never, projects, verifyProjects }) })
    const global = { stubs: { InvoiceExportPreview: preview, NuxtLink: link } }
    const rendered = action === 'switch'
      ? render(parent, { global })
      : render(CentralInvoiceLedgerScreen, { props: { workspace: current as never, projects, verifyProjects }, global })
    await openPreview()
    await fireEvent.click(screen.getByRole('button', { name: '确认测试导出' }))
    await waitFor(() => expect(verifyProjects).toHaveBeenCalledOnce())
    if (action === 'unmount') {
      rendered.unmount()
    }
    else {
      selected.value = workspace(invoice('project'))
      await nextTick()
      expect(screen.queryByTestId('preview')).toBeNull()
      expect(screen.getByRole('alert').textContent).toContain('发票来源或权限已变化')
    }
    release(projects)
    await flushPromises()
    expect(mocks.exportFile).not.toHaveBeenCalled()
  })
}

it('多项目目录失效再恢复时筛选、跨筛选勾选和分页保持现行规则', async () => {
  const base = invoice('project')
  const firstProject = Array.from({ length: 25 }, (_, index) => {
    const id = `first-${String(index + 1).padStart(2, '0')}`
    return { ...base, id, fields: { ...base.fields, invoiceNumber: id } }
  })
  const second = { ...base, id: 'second', projectId: 'project-two', fields: { ...base.fields, invoiceNumber: 'second' } }
  const missing = { ...base, id: 'missing', projectId: 'project-missing', fields: { ...base.fields, invoiceNumber: 'missing' } }
  const noIdentity = { ...base, id: 'no-identity', projectId: null, fields: { ...base.fields, invoiceNumber: 'no-identity' } }
  const unassigned = { ...base, id: 'unassigned', ownerKind: null, projectId: null, fields: { ...base.fields, invoiceNumber: 'unassigned' } }
  const projects = [{ id: 'project-one', label: '同名项目' }, { id: 'project-two', label: '同名项目' }]
  const records: CentralInvoiceRecord[] = [...firstProject, second, missing, noIdentity, unassigned]
  const rendered = render(CentralInvoiceLedgerView, { props: { records, projects, projectsReadable: true }, global: { stubs: { NuxtLink: link } } })
  const tree = within(screen.getByRole('navigation', { name: '按归属' }))
  await fireEvent.click(screen.getByLabelText('选择发票 first-01'))
  await fireEvent.click(tree.getByRole('button', { name: /同名项目 · project-two/ }))
  await fireEvent.click(screen.getByLabelText('选择发票 second'))
  await fireEvent.click(tree.getByRole('button', { name: /同名项目 · project-one/ }))
  await fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  await fireEvent.click(screen.getByLabelText('选择发票 first-21'))
  expect(screen.getByRole('button', { name: '第 2 页' }).getAttribute('aria-current')).toBe('page')
  await rendered.rerender({ projects: [], projectsReadable: false })
  expect(tree.getByRole('button', { name: /^全部/ }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: '第 1 页' }).getAttribute('aria-current')).toBe('page')
  expect(screen.getByText('已选 3 张 · 合计 30.00')).toBeTruthy()
  expect((screen.getByLabelText('选择发票 first-01') as HTMLInputElement).checked).toBe(true)
  expect(tree.getByRole('button', { name: '项目来源或权限不可用' })).toBeTruthy()
  await rendered.rerender({ projects, projectsReadable: true })
  expect(tree.getByRole('button', { name: /^全部/ }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: '第 1 页' }).getAttribute('aria-current')).toBe('page')
  await fireEvent.click(tree.getByRole('button', { name: /^未归属/ }))
  expect(screen.getByRole('button', { name: 'unassigned' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'missing' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'no-identity' })).toBeNull()
  await fireEvent.click(tree.getByRole('button', { name: /^项目来源或权限不可用/ }))
  expect(screen.getByRole('button', { name: 'missing' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'unassigned' })).toBeNull()
  await fireEvent.click(tree.getByRole('button', { name: /^项目身份待核实/ }))
  expect(screen.getByRole('button', { name: 'no-identity' })).toBeTruthy()
  await fireEvent.click(tree.getByRole('button', { name: /同名项目 · project-one/ }))
  expect((screen.getByLabelText('选择发票 first-01') as HTMLInputElement).checked).toBe(true)
  await fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect((screen.getByLabelText('选择发票 first-21') as HTMLInputElement).checked).toBe(true)
  await fireEvent.click(tree.getByRole('button', { name: /同名项目 · project-two/ }))
  expect((screen.getByLabelText('选择发票 second') as HTMLInputElement).checked).toBe(true)
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  expect(rendered.emitted('preparePrint')?.[0]?.[0]).toEqual([records[0], records[20], records[25]])
})

for (const outcome of ['success', 'failure'] as const) {
  it(`旧身份的项目重试${outcome === 'success' ? '成功' : '失败'}迟到，不覆盖新会话结果`, async () => {
    const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'project:list:read'] }
    vi.stubGlobal('useRuntimeConfig', () => ({ app: { baseURL: '/' } }))
    vi.stubGlobal('$fetch', async () => actor)
    const empty = { projects: [], suppliers: [], contracts: [] }
    const newer = { projects: [{ id: 'project-new', label: '新项目', version: '1', sourceVersion: 'projects:2' }], suppliers: [], contracts: [] }
    const older = { projects: [{ id: 'project-old', label: '旧项目', version: '1', sourceVersion: 'projects:1' }], suppliers: [], contracts: [] }
    let calls = 0
    let resolveOld!: (value: typeof older) => void
    let rejectOld!: (reason: Error) => void
    mocks.catalog.mockImplementation(async ([key]: [string]) => {
      if (key !== 'projects')
        return empty
      calls++
      if (calls === 1 || calls === 3)
        throw new Error('项目目录不可读')
      if (calls === 2) {
        return new Promise<typeof older>((resolve, reject) => {
          resolveOld = resolve
          rejectOld = reject
        })
      }
      return newer
    })
    const stub = defineComponent({ props: ['projects', 'projectsReadable'], template: '<div data-testid="catalog-state">{{ projectsReadable ? projects[0]?.label : "项目不可读" }}</div>' })
    render(CentralInvoiceEntry, { props: { mode: 'ledger' }, global: { stubs: { CentralInvoiceLedgerScreen: stub } } })
    await screen.findByText('项目不可读')
    await fireEvent.click(screen.getByRole('button', { name: '重新读取项目目录' }))
    await waitFor(() => expect(calls).toBe(2))
    mocks.authority?.({ message: '身份已变化' })
    await nextTick()
    await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    await waitFor(() => expect(calls).toBe(3))
    await fireEvent.click(await screen.findByRole('button', { name: '重新读取项目目录' }))
    await screen.findByText('新项目')
    expect(calls).toBe(4)
    if (outcome === 'success')
      resolveOld(older)
    else
      rejectOld(new Error('旧项目读取失败'))
    await flushPromises()
    expect(screen.getByText('新项目')).toBeTruthy()
    expect(screen.queryByText('旧项目')).toBeNull()
    expect(screen.queryByText('旧项目读取失败')).toBeNull()
    expect(screen.queryByRole('button', { name: '重新读取项目目录' })).toBeNull()
  })
}
