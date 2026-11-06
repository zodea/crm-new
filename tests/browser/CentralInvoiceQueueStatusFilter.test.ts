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
      ocrStatus: index % 3 === 0 ? 'pending' : index % 3 === 1 ? 'failed' : 'done',
      completionMethod: null,
      reviewStatus: index % 2 === 0 ? 'unreviewed' : 'reviewed',
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

it('真实多选支持键盘取消、并集和关键词交集，保留未保存输入', async ({ task }) => {
  const width = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(window.innerWidth).toBe(Number(width?.[1]))
  const a = fixture('synthetic-a')
  const current = shallowRef(a.workspace)
  await openQueue(current)
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  await page.getByRole('textbox', { name: '购买方', exact: true }).fill('未保存的合成购方')
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '队列' }).click()
  const trigger = page.getByRole('button', { name: '筛选发票状态，已选 0 项' })
  trigger.element().focus()
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('button', { name: '全选', exact: true })).toHaveFocus()
  await userEvent.tab()
  await userEvent.tab()
  await userEvent.tab()
  await userEvent.tab()
  const failed = page.getByRole('checkbox', { name: '识别失败或部分页面未识别' })
  await expect.element(failed).toHaveFocus()
  await userEvent.keyboard(' ')
  await expect.element(failed).toBeChecked()
  await userEvent.keyboard('{Escape}')
  await expect.element(trigger).toHaveFocus()
  await expect.element(page.getByRole('button', { name: '筛选发票状态，已选 0 项' })).toBeVisible()
  await userEvent.keyboard('{Enter}')
  await page.getByRole('checkbox', { name: '识别失败或部分页面未识别' }).click()
  await page.getByRole('checkbox', { name: '识别完成' }).click()
  await page.getByRole('button', { name: '应用' }).click()
  await expect.element(page.getByRole('button', { name: '筛选发票状态，已选 2 项' })).toBeVisible()
  await expect.element(page.getByRole('button', { name: /SYN-002/ })).toBeVisible()
  await expect.element(page.getByRole('button', { name: /SYN-003/ })).toBeVisible()
  expect(page.getByRole('button', { name: /SYN-004/ }).elements()).toHaveLength(0)
  expect(page.getByRole('button', { name: /SYN-001/ }).element().getAttribute('aria-pressed')).toBe('true')
  await page.getByLabelText('搜索发票队列').fill('SYN-003')
  await expect.element(page.getByRole('button', { name: /SYN-003/ })).toBeVisible()
  expect(page.getByRole('button', { name: /SYN-002/ }).elements()).toHaveLength(0)
  await page.getByRole('button', { name: /SYN-003/ }).click()
  expect(confirm).toHaveBeenCalledOnce()
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '校对' }).click()
  await expect.element(page.getByRole('textbox', { name: '购买方', exact: true })).toHaveValue('未保存的合成购方')
  expect(a.execute).not.toHaveBeenCalled()
})

it('来源失效和实例切换关闭浮层并清空筛选与搜索', async () => {
  const a = fixture('synthetic-a')
  const b = fixture('synthetic-b')
  await b.workspace.load()
  const current = shallowRef(a.workspace)
  const search = await openQueue(current)
  await search.fill('SYN-002')
  await page.getByRole('button', { name: '筛选发票状态，已选 0 项' }).click()
  await page.getByRole('checkbox', { name: '识别完成' }).click()
  await page.getByRole('button', { name: '应用' }).click()
  await page.getByRole('button', { name: '筛选发票状态，已选 1 项' }).click()
  await page.getByRole('checkbox', { name: '待核对' }).click()
  a.setAllowed(false)
  await expect(a.workspace.load()).rejects.toThrow('身份或权限已变化')
  a.setAllowed(true)
  await a.workspace.load()
  await nextTick()
  await expect.element(search).toHaveValue('')
  await expect.element(page.getByRole('button', { name: '筛选发票状态，已选 0 项' })).toBeVisible()
  expect(page.getByRole('checkbox', { name: '待核对' }).elements()).toHaveLength(0)
  await search.fill('SYN-003')
  await page.getByRole('button', { name: '筛选发票状态，已选 0 项' }).click()
  await page.getByRole('checkbox', { name: '识别完成' }).click()
  current.value = b.workspace
  await nextTick()
  await expect.element(search).toHaveValue('')
  await expect.element(page.getByRole('button', { name: '筛选发票状态，已选 0 项' })).toBeVisible()
  expect(page.getByRole('checkbox', { name: '识别完成' }).elements()).toHaveLength(0)
  expect(a.execute).not.toHaveBeenCalled()
  expect(b.execute).not.toHaveBeenCalled()
})

it('长队列在筛选后仍局部滚动且页面无溢出', async () => {
  const a = fixture('synthetic-a')
  await openQueue(shallowRef(a.workspace))
  await page.getByRole('button', { name: '筛选发票状态，已选 0 项' }).click()
  await page.getByRole('checkbox', { name: '识别失败或部分页面未识别' }).click()
  await page.getByRole('checkbox', { name: '识别完成' }).click()
  await page.getByRole('button', { name: '应用' }).click()
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
