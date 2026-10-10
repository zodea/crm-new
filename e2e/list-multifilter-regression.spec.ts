import type { OwnerCommercialDocumentSource } from '../app/lib/owner-document/central-repository'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { buildOwnerCommercialDocumentListPage, parseOwnerCommercialDocumentListQuery } from '../app/lib/owner-document/central-repository'
import { expectNoPageOverflow } from './helpers/responsive'

test.use({ screenshot: 'off', trace: 'off', video: 'off' })

const source: OwnerCommercialDocumentSource = {
  dataOrigin: 'real',
  kind: 'owner_change',
  id: 'filter-document-1',
  no: 'FL-001',
  name: '多选示例签证',
  documentType: 'site_visa',
  projectId: null,
  projectName: '',
  projectPermission: 'allowed',
  customerId: null,
  customerName: '',
  customerPermission: 'allowed',
  contractId: null,
  contractNo: '',
  contractName: '',
  contractPermission: 'allowed',
  sourceType: 'manual',
  sourceId: 'filter-document-1',
  sourceLocked: false,
  periodNo: '',
  applicationDate: null,
  status: 'approved',
  statusNote: '',
  amount: 100,
  taxExclusiveAmount: 90,
  appliedTaxExclusiveAmount: 90,
  auditedAmount: null,
  note: '',
  version: 1,
  createdAt: '2026-09-08T00:00:00.000Z',
  updatedAt: '2026-09-08T00:00:00.000Z',
  lines: [],
  files: [],
}

test.beforeEach(async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `multifilter-${randomUUID()}` })
  await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'false'))
  await page.clock.install({ time: new Date('2026-10-03T04:00:00.000Z') })
})

for (const input of [
  { firstNo: 'FL-001', nextNo: 'FL-002', firstType: 'site_visa', firstTypeLabel: '现场签证', nextType: 'change_negotiation', nextStatus: 'submitted', nextStatusLabel: '已上报', firstAmount: 100, nextAmount: 200 },
  { firstNo: 'FL-101', nextNo: 'FL-102', firstType: 'change_negotiation', firstTypeLabel: '变更洽商', nextType: 'site_visa', nextStatus: 'draft', nextStatusLabel: '草稿', firstAmount: 250, nextAmount: 450 },
]) {
  test(`${input.firstNo}/${input.nextStatus}单据多选联动完整结果、清空与无闪动刷新，各宽度无页面溢出`, async ({ page }) => {
    const documents = [{ ...source, no: input.firstNo, documentType: input.firstType, amount: input.firstAmount }, { ...source, id: 'filter-document-2', no: input.nextNo, status: input.nextStatus, documentType: input.nextType, amount: input.nextAmount }]
    await page.route('**/api/read/owner-documents/owner_change?*', async (route) => {
      const query = parseOwnerCommercialDocumentListQuery('owner_change', Object.fromEntries(new URL(route.request().url()).searchParams))
      await route.fulfill({ json: buildOwnerCommercialDocumentListPage({ documents, query, asOf: '2026-09-08T00:00:00.000Z', sourceVersion: 'multifilter-synthetic', capabilities: ['owner-document:read'] }) })
    })
    await page.goto('/owner/change')
    const table = page.locator('[data-ui="owner-document-table"]')
    await expect(table.getByRole('link', { name: input.firstNo, exact: true })).toBeVisible()
    await page.getByRole('button', { name: '状态，已选 1 项' }).click()
    const dialog = page.getByRole('dialog', { name: /^状态/ })
    await dialog.getByRole('checkbox', { name: input.nextStatusLabel, exact: true }).check()
    await dialog.getByRole('button', { name: '应用', exact: true }).click()
    await expect(table.getByRole('link', { name: input.nextNo, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '状态，已选 2 项' })).toBeVisible()
    await expect.poll(() => {
      const status = new URL(page.url()).searchParams.get('status')
      return status?.startsWith('[') ? JSON.parse(status).sort() : status
    }).toEqual(['approved', input.nextStatus].sort())
    await page.reload()
    await expect(page.getByRole('button', { name: '状态，已选 2 项' })).toBeVisible()
    await page.getByRole('button', { name: '类型，已选 0 项' }).click()
    const types = page.getByRole('dialog', { name: /^类型/ })
    await types.getByRole('checkbox', { name: input.firstTypeLabel, exact: true }).check()
    await types.getByRole('button', { name: '应用', exact: true }).click()
    await expect(table.getByRole('link', { name: input.nextNo, exact: true })).toHaveCount(0)
    await expect(table.getByRole('link', { name: input.firstNo, exact: true })).toBeVisible()
    let finish!: () => void
    const pending = new Promise<void>(resolve => finish = resolve)
    await page.route('**/api/read/owner-documents/owner_change?*', async (route) => {
      await pending
      await route.fallback()
    })
    await page.getByRole('button', { name: '刷新甲方变洽签', exact: true }).click()
    try {
      await expect(table).toHaveAttribute('aria-busy', 'true')
      await expect(table.locator('[data-ui="kit-table-loading"]')).toBeHidden()
      await expect(table.getByRole('link', { name: input.firstNo, exact: true })).toBeVisible()
    }
    finally { finish() }
    await expect(table).toHaveAttribute('aria-busy', 'false')
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `${width}px 多选筛选`)
    }
    await page.getByRole('button', { name: '类型，已选 1 项' }).click()
    await types.getByRole('button', { name: '清除', exact: true }).click()
    await expect(table.getByRole('link', { name: input.nextNo, exact: true })).toBeVisible()
  })
}

for (const [path, label] of [['/project/target-cost?origin=real', '状态'], ['/subcontract/payroll?origin=real', '工资状态']] as const) {
  test(`${path} 当前具名状态多选、应用与键盘关闭`, async ({ page }) => {
    await page.goto(path)
    const trigger = page.getByRole('button', { name: new RegExp(`^${label}，已选`) })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: new RegExp(`^${label}`) })
    await expect(dialog.getByRole('button', { name: '全选', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '应用', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    await expectNoPageOverflow(page, path)
  })
}

for (const input of [
  { query: 'draft', draft: true, confirmed: false },
  { query: 'confirmed', draft: false, confirmed: true },
  { query: '["draft","confirmed"]', draft: true, confirmed: true },
  { query: '', draft: false, confirmed: false },
]) {
  test(`中央签工确认状态多选恢复与键盘更改：${input.query || '不限'}`, async ({ page }) => {
    await page.goto(`/subcontract/daywork?origin=real&dayworkStatus=${encodeURIComponent(input.query)}`)
    const statuses = page.getByRole('group', { name: '签工确认状态' })
    const draft = statuses.getByRole('checkbox', { name: '待确认', exact: true })
    const confirmed = statuses.getByRole('checkbox', { name: '已确认', exact: true })
    await expect(draft).toBeChecked({ checked: input.draft })
    await expect(confirmed).toBeChecked({ checked: input.confirmed })
    await confirmed.focus()
    await page.keyboard.press('Space')
    await expect(confirmed).toBeChecked({ checked: !input.confirmed })
    await expect.poll(() => {
      const value = new URL(page.url()).searchParams.get('dayworkStatus')
      return value?.startsWith('[') ? JSON.parse(value).sort() : value ? [value] : []
    }).toEqual([...(input.draft ? ['draft'] : []), ...(!input.confirmed ? ['confirmed'] : [])].sort())
    await expectNoPageOverflow(page, '中央签工确认状态')
  })
}
