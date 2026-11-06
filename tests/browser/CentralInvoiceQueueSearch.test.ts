import type { ShallowRef } from 'vue'
import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { computed, defineComponent, h, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'
import { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'

const confirm = vi.hoisted(() => vi.fn(async () => false))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))
beforeEach(() => {
  confirm.mockReset().mockResolvedValue(false)
  for (const [name, value] of Object.entries({ computed, shallowRef, useTemplateRef, watch }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('useEventListener', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function fixture(workspaceId: string) {
  const records: CentralInvoiceRecord[] = Array.from({ length: 36 }, (_, index) => {
    const number = String(index + 1).padStart(3, '0')
    return {
      id: `row-${number}`,
      version: '1',
      sourceKind: 'manual',
      fields: { invoiceNumber: `SYN-${number}`, invoiceDate: '', invoiceType: '', buyer: `合成购方${number}`, buyerTaxNo: '', seller: `合成销方${number}`, sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: index === 0 ? 0 : null, taxRate: '', remark: '' },
      items: [],
      unrecognizedPageIndexes: [],
      ocrStatus: 'pending',
      completionMethod: null,
      reviewStatus: 'unreviewed',
      accountStatus: 'none',
      duplicateStatus: 'normal',
      printCount: 0,
      printRotation: 0,
      ownerKind: null,
      projectId: null,
      supplierId: null,
      contract: null,
      archivedAt: null,
      original: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
    }
  })
  const memory = new Map<string, string>()
  const storage = {
    get length() { return memory.size },
    key: (index: number) => [...memory.keys()][index] ?? null,
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value) },
    removeItem: (key: string) => { memory.delete(key) },
  }
  let allowed = true
  const execute = vi.fn()
  const workspace = createCentralInvoiceWorkspace({
    identity: { workspaceId, actorId: 'synthetic-actor' },
    context: async () => ({ workspaceId, actorId: 'synthetic-actor', capabilities: allowed ? ['finance-invoice:read', 'finance-invoice:write'] : [] }),
    client: { list: async () => ({ items: structuredClone(records), pagination: { total: records.length }, sourceVersion: 'invoices:1', meta: { sources: [{ key: 'invoices', sourceVersion: 'invoices:1' }] } }), execute } as never,
    recognizeLocal: vi.fn() as never,
    storage: () => storage,
  })
  return {
    workspace,
    execute,
    setAllowed: (next: boolean) => { allowed = next },
  }
}
function host(current: ShallowRef<ReturnType<typeof createCentralInvoiceWorkspace>>) {
  return defineComponent({ setup: () => () => h('div', { style: 'height: 100vh; display: flex; flex-direction: column' }, [h(CentralInvoiceWorkspaceScreen, { workspace: current.value, projects: [], suppliers: [], signatories: [], initialSelectedId: 'row-001' })]) })
}
async function openQueue(current: ShallowRef<ReturnType<typeof createCentralInvoiceWorkspace>>) {
  await render(host(current), { global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  const search = page.getByLabelText('搜索发票队列')
  await expect.element(search).toBeVisible()
  return search
}
it('键盘搜索、零匹配说明和当前选中票保留', async ({ task }) => {
  const width = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(window.innerWidth).toBe(Number(width?.[1]))
  const a = fixture('synthetic-a')
  const current = shallowRef(a.workspace)
  const search = await openQueue(current)
  search.element().focus()
  await expect.element(search).toHaveFocus()
  await userEvent.keyboard('SYN-025')
  await expect.element(page.getByRole('button', { name: /SYN-025/ })).toBeVisible()
  const first = page.getByRole('button', { name: /SYN-001/ })
  await expect.element(first).toBeVisible()
  expect(first.element().getAttribute('aria-pressed')).toBe('true')
  await expect.element(page.getByText('当前选中发票不符合搜索条件，仍保留以便继续处理。')).toBeVisible()
  await search.fill('无匹配的合成词')
  await expect.element(page.getByText('当前已读取的发票中没有匹配结果。')).toBeVisible()
  expect(first.element().getAttribute('aria-pressed')).toBe('true')
  expect(a.execute).not.toHaveBeenCalled()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
it('未保存输入在搜索后保留，切换票据仍需确认', async () => {
  const a = fixture('synthetic-a')
  const current = shallowRef(a.workspace)
  await openQueue(current)
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  await page.getByRole('textbox', { name: '购买方', exact: true }).fill('未保存的合成购方')
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '队列' }).click()
  await page.getByLabelText('搜索发票队列').fill('SYN-025')
  await page.getByRole('button', { name: /SYN-025/ }).click()
  expect(confirm).toHaveBeenCalledOnce()
  expect(page.getByRole('button', { name: /SYN-001/ }).element().getAttribute('aria-pressed')).toBe('true')
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  await expect.element(page.getByRole('textbox', { name: '购买方', exact: true })).toHaveValue('未保存的合成购方')
  expect(a.execute).not.toHaveBeenCalled()
})
it('失权恢复及工作区换实例后不保留旧搜索词', async () => {
  const a = fixture('synthetic-a')
  const b = fixture('synthetic-b')
  await b.workspace.load()
  const current = shallowRef(a.workspace)
  const search = await openQueue(current)
  await search.fill('合成购方025')
  a.setAllowed(false)
  await expect(a.workspace.load()).rejects.toThrow('身份或权限已变化')
  a.setAllowed(true)
  await a.workspace.load()
  await nextTick()
  await expect.element(search).toHaveValue('')
  await search.fill('合成销方026')
  current.value = b.workspace
  await nextTick()
  await expect.element(search).toHaveValue('')
  expect(a.execute).not.toHaveBeenCalled()
  expect(b.execute).not.toHaveBeenCalled()
})
it('长队列在自身区域滚动，不撑宽页面', async () => {
  const a = fixture('synthetic-a')
  const current = shallowRef(a.workspace)
  await openQueue(current)
  const queue = page.getByRole('region', { name: '发票队列' }).element()
  const scroller = queue.querySelector<HTMLElement>('.overflow-auto')
  expect(scroller).not.toBeNull()
  expect(scroller!.scrollHeight).toBeGreaterThan(scroller!.clientHeight)
  const outerTop = document.documentElement.scrollTop
  await userEvent.wheel(scroller!, { delta: { y: 500 } })
  await expect.poll(() => scroller!.scrollTop).toBeGreaterThan(0)
  expect(document.documentElement.scrollTop).toBe(outerTop)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
  expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(document.documentElement.clientHeight + 1)
})
