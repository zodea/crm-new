import type { OwnerCommercialDocumentSource } from '../app/lib/owner-document/central-repository'
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

for (const width of [390, 768, 1024, 1440]) {
  test(`${width}px 单据多选联动完整结果、清空与无闪动刷新`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const documents = [source, { ...source, id: 'filter-document-2', no: 'FL-002', status: 'submitted', documentType: 'change_negotiation' }]
    await page.route('**/api/read/owner-documents/owner_change?*', async (route) => {
      const query = parseOwnerCommercialDocumentListQuery('owner_change', Object.fromEntries(new URL(route.request().url()).searchParams))
      await route.fulfill({ json: buildOwnerCommercialDocumentListPage({ documents, query, asOf: '2026-09-08T00:00:00.000Z', sourceVersion: 'multifilter-synthetic', capabilities: ['owner-document:read'] }) })
    })
    await page.goto('/owner/change')
    const table = page.locator('[data-ui="owner-document-table"]')
    await expect(table.getByRole('link', { name: 'FL-001', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '状态，已选 1 项' }).click()
    const dialog = page.getByRole('dialog', { name: /^状态/ })
    await dialog.getByRole('checkbox', { name: '已上报', exact: true }).check()
    await dialog.getByRole('button', { name: '应用', exact: true }).click()
    await expect(table.getByRole('link', { name: 'FL-002', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '状态，已选 2 项' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: '状态，已选 2 项' })).toBeVisible()
    await page.getByRole('button', { name: '类型，已选 0 项' }).click()
    const types = page.getByRole('dialog', { name: /^类型/ })
    await types.getByRole('checkbox', { name: /现场签证/ }).check()
    await types.getByRole('button', { name: '应用', exact: true }).click()
    await expect(table.getByRole('link', { name: 'FL-002', exact: true })).toHaveCount(0)
    await expect(table.getByRole('link', { name: 'FL-001', exact: true })).toBeVisible()
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
      await expect(table.getByRole('link', { name: 'FL-001', exact: true })).toBeVisible()
    }
    finally { finish() }
    await expect(table).toHaveAttribute('aria-busy', 'false')
    await expectNoPageOverflow(page, `${width}px 多选筛选`)
    await page.getByRole('button', { name: '类型，已选 1 项' }).click()
    await types.getByRole('button', { name: '清除', exact: true }).click()
    await expect(table.getByRole('link', { name: 'FL-002', exact: true })).toBeVisible()
  })
}

test('目标成本和工资、签工使用同一多选控件', async ({ page }) => {
  for (const [path, label] of [['/project/target-cost', '状态'], ['/subcontract/payroll', '状态'], ['/subcontract/daywork', '确认状态']]) {
    await page.goto(path!)
    await page.getByRole('button', { name: new RegExp(`^${label}，已选`) }).click()
    const dialog = page.getByRole('dialog', { name: new RegExp(`^${label}`) })
    await expect(dialog.getByRole('button', { name: '全选', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '应用', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expectNoPageOverflow(page, path!)
  }
})
