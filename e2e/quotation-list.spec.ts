import type { QuotationDraft, QuotationRecord } from '../app/lib/material-quotation/contract'
import { expect, test } from '@playwright/test'
import { newQuotationDraft } from '../app/lib/material-quotation/contract'
import { createReadMeta, withReadMeta } from '../server/utils/read-meta'
import { expectLocalHorizontalScroll, expectNoPageOverflow, RESPONSIVE_WIDTHS, tabUntilFocused } from './helpers/responsive'

const recordsEndpoint = /\/api\/read\/material-quotations$/
const asOf = '2026-10-05T00:00:00Z'
const actorId = 'quotation-actor'

function quotation(id: string, overrides: Partial<QuotationDraft>): QuotationRecord {
  const defaults = newQuotationDraft()
  const draft = {
    ...defaults,
    lines: [{ ...defaults.lines[0]!, id: `${id}-line`, name: '来样材料', unit: '吨' }],
    ...overrides,
  }
  return {
    id,
    draft,
    version: '1',
    createdAt: asOf,
    updatedAt: asOf,
    attachments: [],
    history: [{ version: '1', draft, files: [], actorId, commandId: `${id}-command`, occurredAt: asOf }],
  }
}

const listRows = [
  quotation('quotation-b', { partyName: '乙方原报价方', scope: 'general' }),
  quotation('quotation-a', { partyName: '甲方原报价方', scope: 'project', projectId: 'project-a', supplierId: 'supplier-a', quotationDate: '2026-10-01' }),
]

function authorizedRead(records: QuotationRecord[], capabilities: string[]) {
  const meta = createReadMeta({
    session: { workspaceId: 'quotation-workspace', actorId, capabilities: ['material-quotation:read', ...capabilities] },
    schemaVersion: 'material-quotation-read-v1',
    operation: 'material-quotation:list',
    dataOrigin: 'real',
    asOf,
    coverage: 'permission-filtered',
    scope: {},
    sources: [{ key: 'material-quotations', state: 'readable', sourceVersion: 'quotation:1', asOf }],
  })
  return withReadMeta({ records }, meta)
}

test('报价列表保留授权边界、来源顺序和各视口键盘入口', async ({ page }) => {
  test.setTimeout(90_000)
  await page.route(recordsEndpoint, route => route.fulfill({ json: authorizedRead(listRows, ['material-quotation:write']) }))
  await page.goto('/material/quotations')
  const partyLinks = page.getByRole('link', { name: /原报价方$/ })
  await expect(partyLinks).toHaveText(['乙方原报价方', '甲方原报价方'], { timeout: 30_000 })
  const table = page.getByRole('region', { name: '报价清单横向滚动区域' })
  await expect(page.locator('[data-list-shell].list-shell--continuous')).toBeVisible()
  await expect(table).toHaveAttribute('data-ui', 'kit-table')
  await expect(page.getByText('清单仅包含本次有权读取的报价，不能作为全部报价数量。')).toBeVisible()
  const create = page.getByRole('link', { name: '新增报价', exact: true })
  await expect(create).toHaveAttribute('href', '/material/quotations/form')
  await expect(page.getByRole('link', { name: '核验本地报价迁入', exact: true })).toHaveCount(0)
  await expect(table.locator('[data-ui="status-tag"]').filter({ hasText: '未关联目录身份' })).toBeVisible()
  await expect(table.locator('[data-ui="status-tag"]').filter({ hasText: '已明确关联分供方' })).toBeVisible()
  await expect(page.getByText('未知', { exact: true })).toBeVisible()
  await expect(page.getByText('2026-10-01', { exact: true })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: '材料行' })).toBeVisible()
  const firstRow = table.getByRole('row').filter({ has: partyLinks.first() })
  await expect(firstRow.getByRole('cell').nth(3)).toHaveText('1')
  const edit = page.getByRole('link', { name: '编辑', exact: true }).and(page.locator('a[href="/material/quotations/form/quotation-b"]'))
  await expect(edit).toBeVisible()

  for (const width of RESPONSIVE_WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await expectNoPageOverflow(page, `报价列表 ${width}px`)
  }
  await page.setViewportSize({ width: 390, height: 900 })
  const scroll = table.locator('.vxe-table--scroll-x-handle')
  await expect.poll(() => scroll.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
  await expectLocalHorizontalScroll(scroll, '报价列表')
  await create.focus()
  await tabUntilFocused(page, scroll)
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)

  await partyLinks.first().focus()
  await expect(partyLinks.first()).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/material\/quotations\/quotation-b$/)
})

test('报价列表读失败可重试，独立迁入权限不开放报价写入', async ({ page }) => {
  let read = 0
  await page.route(recordsEndpoint, (route) => {
    read++
    if (read === 1)
      return route.fulfill({ status: 503, json: { code: 'unavailable', message: '报价来源暂不可用', fieldErrors: {}, retryable: true, traceId: null } })
    return route.fulfill({ json: authorizedRead(read === 2 ? listRows : [], ['core:migration:write']) })
  })
  await page.goto('/material/quotations')
  await expect(page.getByRole('alert', { name: '报价读取失败' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByRole('link', { name: '核验本地报价迁入', exact: true })).toHaveAttribute('href', '/material/quotations/import')
  await expect(page.getByRole('link', { name: '乙方原报价方', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '新增报价', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '编辑', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('status', { name: '当前可读取范围内暂无报价' })).toBeVisible()
})
