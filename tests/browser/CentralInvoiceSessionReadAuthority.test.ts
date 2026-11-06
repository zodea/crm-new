import type { CentralInvoiceCommand, CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { computed, shallowRef, useTemplateRef, watch } from 'vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'
import { createCentralInvoiceHttp } from '~/lib/invoice/central-http'
import { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))
beforeEach(() => {
  for (const [name, value] of Object.entries({ computed, shallowRef, useTemplateRef, watch }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('useEventListener', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function fixture() {
  const identity = { workspaceId: 'synthetic-workspace', actorId: 'synthetic-actor' }
  const granted = ['finance-invoice:read', 'finance-invoice:write']
  const at = '2026-01-01T00:00:00.000Z'
  let capabilities = [...granted]
  let row: CentralInvoiceRecord = { id: 'invoice-001', version: '1', sourceKind: 'manual', fields: { invoiceNumber: 'SYN-001', invoiceDate: '', invoiceType: '', buyer: '合成原购方', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'pending', completionMethod: null, reviewStatus: 'unreviewed', accountStatus: 'none', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: null, projectId: null, supplierId: null, contract: null, archivedAt: null, original: null, createdAt: at, updatedAt: at, deletedAt: null }
  const entered = deferred()
  const release = deferred()
  let gated = true
  let receipt: { commandId: string, invoiceId: string, version: string, originalId: null, updatedAt: string } | undefined
  const data = new Map<string, string>()
  const storage = () => ({
    get length() { return data.size },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  })
  function evidence(scope: string) {
    const sourceVersion = `read-synthetic-${row.version}`
    const meta = { schemaVersion: 'invoice-read-v1', ...identity, dataOrigin: 'real', asOf: at, sourceVersion, sources: [{ key: 'invoices', state: 'readable', sourceVersion: `invoices:${row.version}`, asOf: at }], authorizedScope: { coverage: 'complete', fingerprint: scope }, capabilities: [...granted] }
    return { dataOrigin: 'real', asOf: at, sourceVersion, capabilities: [...granted], meta }
  }
  const fetcher = vi.fn<Parameters<typeof createCentralInvoiceHttp>[0]>(async (url, options) => {
    if (url === '/api/read/invoices')
      return { ...evidence('scope-list'), items: [structuredClone(row)], pagination: { requestedPage: 1, page: 1, pageSize: 100, total: 1 } }
    if (url === '/api/commands/invoices') {
      const command = options?.body as CentralInvoiceCommand
      if (command.action !== 'edit' || command.invoiceId !== row.id || command.baseVersion !== row.version)
        throw new Error('合成命令身份或版本错误')
      row = { ...row, version: '2', fields: structuredClone(command.fields), items: structuredClone(command.items) }
      receipt = { commandId: command.commandId, invoiceId: row.id, version: row.version, originalId: null, updatedAt: at }
      return receipt
    }
    if (url === '/api/commands/invoices/resolve')
      return { outcome: 'applied', result: receipt }
    if (url === '/api/read/invoices/invoice-001') {
      if (gated) {
        entered.resolve()
        await release.promise
        gated = false
      }
      return { ...evidence('scope-detail'), record: structuredClone(row) }
    }
    throw new Error(`拒绝未知合成请求 ${url}`)
  })
  const client = createCentralInvoiceHttp(fetcher, identity)
  const workspace = createCentralInvoiceWorkspace({ identity, client, context: async () => ({ ...identity, capabilities: [...capabilities] }), storage, commandId: () => 'synthetic-command', recognizeLocal: async () => {
    throw new Error('未使用识别')
  } })
  return {
    workspace,
    fetcher,
    entered,
    release,
    revoke: () => { capabilities = ['finance-invoice:write'] },
    restore: () => { capabilities = [...granted] },
  }
}

it('读取权失效遮蔽票面，恢复后可键盘核对原编号而不重复写入', async ({ task }) => {
  const width = /^chromium-(390|1280)$/.exec(task.file.projectName ?? '')
  expect(window.innerWidth).toBe(Number(width?.[1]))
  const f = fixture()
  await f.workspace.load()
  await render(CentralInvoiceWorkspaceScreen, { props: { workspace: f.workspace, projects: [], suppliers: [], signatories: [], initialSelectedId: 'invoice-001' }, global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  const buyer = page.getByLabelText('购买方', { exact: true })
  await expect.element(buyer).toHaveValue('合成原购方')
  await buyer.fill('合成已提交购方')
  const save = page.getByRole('button', { name: '保存修改' })
  save.element().focus()
  await expect.element(save).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await f.entered.promise
  f.revoke()
  f.release.resolve()
  await expect.poll(() => f.workspace.readState.value).toBe('unavailable')
  expect(f.workspace.pending('invoice-001')?.commandId).toBe('synthetic-command')
  await expect.element(buyer).not.toBeVisible()
  await expect.element(page.getByText('发票来源尚不可用。')).toBeVisible()
  expect(f.workspace.records.value).toEqual([])
  f.restore()
  const retry = page.getByRole('button', { name: '重新读取' })
  retry.element().focus()
  await expect.element(retry).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const recover = page.getByRole('button', { name: '核对上次提交' })
  await expect.element(recover).toBeVisible()
  await expect.element(page.getByText('上次提交结果尚未核对，不能换编号重复提交。')).toBeVisible()
  recover.element().focus()
  await expect.element(recover).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => f.workspace.pending('invoice-001')).toBeNull()
  await expect.poll(() => f.workspace.readState.value).toBe('ready')
  expect(f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices')).toHaveLength(1)
  const resolutions = f.fetcher.mock.calls.filter(([url]) => url === '/api/commands/invoices/resolve')
  expect(resolutions).toHaveLength(1)
  expect(resolutions[0]![1]?.body).toEqual({ commandId: 'synthetic-command' })
})
