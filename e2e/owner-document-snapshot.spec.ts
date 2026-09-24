import type { OwnerCommercialDocumentSource } from '../app/lib/owner-document/central-repository'
import { expect, test } from '@playwright/test'
import { buildOwnerCommercialDocumentListPage, parseOwnerCommercialDocumentListQuery } from '../app/lib/owner-document/central-repository'

test.use({ screenshot: 'off', trace: 'off', video: 'off' })

const document: OwnerCommercialDocumentSource = {
  dataOrigin: 'real',
  kind: 'owner_change',
  id: 'snapshot-document',
  no: 'SNAP-001',
  name: '快照隔离签证',
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
  sourceId: 'snapshot-document',
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

test('普通错误保留旧表，受限错误清空权限与记录，重试及成功空快照边界正确', async ({ page }) => {
  let failure: 'unavailable' | 'forbidden' | null = null
  let empty = false
  let hold: Promise<void> | null = null
  let release!: () => void
  await page.route('**/api/read/owner-documents/owner_change?*', async (route) => {
    if (hold)
      await hold
    if (failure) {
      await route.fulfill({ status: failure === 'forbidden' ? 403 : 503, json: { code: failure, message: failure === 'forbidden' ? '当前无单据读取权限' : '连接暂时不可用', retryable: true, fieldErrors: {}, traceId: null } })
      return
    }
    const query = parseOwnerCommercialDocumentListQuery('owner_change', Object.fromEntries(new URL(route.request().url()).searchParams))
    await route.fulfill({ json: buildOwnerCommercialDocumentListPage({ documents: empty ? [] : [document], query, asOf: document.updatedAt, sourceVersion: 'snapshot-regression', capabilities: ['owner-document:read', 'owner-document:write'] }) })
  })
  await page.goto('/owner/change')
  const table = page.locator('[data-ui="owner-document-table"]')
  const oldRow = table.getByRole('link', { name: 'SNAP-001', exact: true })
  await expect(oldRow).toBeVisible()
  failure = 'unavailable'
  await page.getByRole('button', { name: '刷新甲方变洽签', exact: true }).click()
  await expect(page.getByText(/当前保留上一次成功读取的列表/)).toBeVisible()
  await expect(oldRow).toBeVisible()

  failure = 'forbidden'
  await page.getByRole('button', { name: '重新载入', exact: true }).click()
  await expect(page.getByText('当前无单据读取权限', { exact: true })).toBeVisible()
  await expect(oldRow).toHaveCount(0)
  await expect(page.getByRole('button', { name: '新建甲方变洽签', exact: true })).toHaveCount(0)
  failure = null
  empty = true
  hold = new Promise(resolve => release = resolve)
  await page.getByRole('button', { name: '重新载入', exact: true }).click()
  try {
    await expect(table).toHaveAttribute('aria-busy', 'true')
    await expect(table.locator('[data-ui="kit-table-loading"]')).toBeVisible()
    await expect(oldRow).toHaveCount(0)
    await expect(page.getByRole('button', { name: '新建甲方变洽签', exact: true })).toHaveCount(0)
  }
  finally {
    release()
    hold = null
  }
  await expect(table).toHaveAttribute('aria-busy', 'false')

  hold = new Promise(resolve => release = resolve)
  await page.getByRole('button', { name: '刷新甲方变洽签', exact: true }).click()
  try {
    await expect(table).toHaveAttribute('aria-busy', 'true')
    await expect(table.locator('[data-ui="kit-table-loading"]')).toBeHidden()
  }
  finally {
    release()
    hold = null
  }
  await expect(table).toHaveAttribute('aria-busy', 'false')
})

test('验收切至保修等待期间不沿用前视图的记录和权限', async ({ page }) => {
  let release!: () => void
  const warrantyPending = new Promise<void>(resolve => release = resolve)
  await page.route('**/api/read/owner-documents/acceptance?*', async (route) => {
    const query = parseOwnerCommercialDocumentListQuery('acceptance', Object.fromEntries(new URL(route.request().url()).searchParams))
    if (query.variant === 'warranty')
      await warrantyPending
    const documents: OwnerCommercialDocumentSource[] = query.variant === 'warranty'
      ? [{ ...document, kind: 'acceptance', id: 'warranty', no: 'BX-SNAPSHOT', status: 'warranty' }]
      : [{ ...document, kind: 'acceptance', no: 'YS-SNAPSHOT', status: 'accepted' }]
    await route.fulfill({ json: buildOwnerCommercialDocumentListPage({ documents, query, asOf: document.updatedAt, sourceVersion: 'variant-regression', capabilities: ['owner-document:read'] }) })
  })
  await page.goto('/owner/acceptance?variant=acceptance&status=all')
  const table = page.locator('[data-ui="owner-document-table"]')
  await expect(table.getByRole('link', { name: 'YS-SNAPSHOT', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '保修到期确认', exact: true }).click()
  try {
    await expect(table).toHaveAttribute('aria-busy', 'true')
    await expect(table.locator('[data-ui="kit-table-loading"]')).toBeVisible()
    await expect(table.getByRole('link', { name: 'YS-SNAPSHOT', exact: true })).toHaveCount(0)
  }
  finally { release() }
  await expect(table.getByRole('link', { name: 'BX-SNAPSHOT', exact: true })).toBeVisible()
  await expect(table.getByRole('link', { name: 'YS-SNAPSHOT', exact: true })).toHaveCount(0)
})
