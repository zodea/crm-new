import type { APIRequestContext, Page } from '@playwright/test'
import type { CoreMigrationBatchDTO, CoreMigrationEntityType, CoreMigrationSnapshotDTO } from '../app/lib/migration/core-contract'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { LATEST_VERSION, migrations, runMigrations } from '../app/lib/db/migrations'
import { createMemoryDb } from '../tests/helpers/memory-db'
import { writeProductionSnapshot } from './helpers/browser-production-snapshot'
import { expectLocalHorizontalScroll, expectNoPageOverflow } from './helpers/responsive'

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1280, height: 900 },
  { width: 1440, height: 1000 },
] as const

const MIGRATION_NOW = '2026-10-03T04:00:00.000Z'
const SOURCE_CREATED_AT = '2026-07-01T04:00:00.000Z'
const MIGRATION_INPUTS = [
  { name: '正量价', projectName: '迁移验收项目甲', customerName: '迁移验收客户甲', supplierName: '迁移验收分供方甲', area: 125.5, contractAmount: 8800, expectedAmount: '8800.00', libraryName: '迁移验收工序甲', durationDays: 3, deletedAt: '2026-08-15T08:00:00.000Z' },
  { name: '显式零量价', projectName: '迁移验收项目乙', customerName: '迁移验收客户乙', supplierName: '迁移验收分供方乙', area: 0, contractAmount: 0, expectedAmount: '0.00', libraryName: '迁移验收工序乙', durationDays: 7, deletedAt: '2026-09-20T08:00:00.000Z' },
] as const
type MigrationInput = (typeof MIGRATION_INPUTS)[number]

async function migrationCommand(page: Page, label: string, endpoint: string) {
  const receipt = page.waitForResponse(response =>
    new URL(response.url()).pathname === endpoint && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: label, exact: true }).click()
  const response = await receipt
  expect(response.ok(), `${label} 的真实中央回执`).toBe(true)
  return response
}

async function expectSoftDeletedGraphs(page: Page) {
  const table = page.getByRole('table', { name: '迁移对账问题' })
  for (const entity of ['分供方', '分供方证照、原件与核验凭证']) {
    const row = table.getByRole('row').filter({
      has: page.getByRole('cell', { name: entity, exact: true }),
    }).filter({ has: page.getByRole('cell', { name: 'supplier-local-294', exact: true }) })
    await expect(row.getByText('已保留软删除', { exact: true })).toBeVisible()
  }
}

async function reloadMigrationPage(page: Page) {
  // 完整文档导航重新创建 SQLite 连接和页面状态。
  await page.goto('/settings/data-migration')
  await expect(page.getByTestId('core-migration-page')).toBeVisible({ timeout: 30_000 })
}

async function resetMigrationBackend(request: APIRequestContext) {
  const response = await request.post('/api/testing/core-migration/reset', {
    headers: { 'x-ruihang-test-reset': '1' },
  })
  expect(response.ok()).toBe(true)
  expect(await response.json()).toEqual({ authority: 'local', activeBatchId: null })
}

function expectCompleteGraph(snapshot: CoreMigrationSnapshotDTO, input: MigrationInput) {
  const expected = [
    { entityType: 'customers', legacyId: 'customer-local-294', name: input.customerName },
    { entityType: 'suppliers', legacyId: 'supplier-local-294', name: input.supplierName },
    { entityType: 'supplier_credentials', legacyId: 'supplier-local-294', name: input.supplierName },
    { entityType: 'crews', legacyId: 'crew-local-294', name: '迁移验收班组' },
    { entityType: 'projects', legacyId: 'project-local-294', name: input.projectName },
    { entityType: 'workers', legacyId: 'worker-local-294', name: '迁移验收工人' },
    { entityType: 'project_suppliers', legacyId: 'project-supplier-local-294', name: 'project-local-294 × supplier-local-294' },
    { entityType: 'process_libraries', legacyId: 'library-local-294', name: input.libraryName },
  ]
  expect(snapshot.entities.map(({ entityType, legacyId, name }) => ({ entityType, legacyId, name })))
    .toEqual(expect.arrayContaining(expected))
  expect(snapshot.entities).toHaveLength(expected.length)
  expect(new Set(snapshot.entities.map(entity => entity.id)).size).toBe(expected.length)
  const entity = (entityType: CoreMigrationEntityType) => snapshot.entities.find(row => row.entityType === entityType)!
  const customer = entity('customers')
  const project = entity('projects')
  const supplier = entity('suppliers')
  expect(project).toMatchObject({ quantity: input.area, amount: input.expectedAmount, references: { customerId: customer.id, secondaryCustomerId: null } })
  expect(entity('workers').references).toEqual({ crewId: entity('crews').id, projectId: project.id })
  expect(entity('project_suppliers').references).toEqual({ projectId: project.id, supplierId: supplier.id })
  const credentials = entity('supplier_credentials')
  expect(credentials.references).toEqual({ supplierId: supplier.id })
  expect(JSON.parse(String(credentials.attributes.graphJson))).toMatchObject({
    schemaVersion: 2,
    supplier: { id: 'supplier-local-294', name: input.supplierName },
    credentials: [],
    files: [],
    payloads: [],
    credentialAudits: [],
    supplierAudits: [],
    reviewHistory: [],
  })
  expect(JSON.parse(String(entity('process_libraries').attributes.graphJson))).toMatchObject({
    schemaVersion: 1,
    library: { id: 'library-local-294', name: input.libraryName, version: 1 },
    tasks: [{ id: 'library-task-local-294', library_id: 'library-local-294', task_key: 'setting-out', name: '放线', duration_days: input.durationDays }],
  })
  return { project, customer }
}

async function legacyProductionSnapshot(input: MigrationInput, options: { withSoftDeletedSupplier?: boolean } = {}): Promise<Uint8Array> {
  const db = await createMemoryDb()
  await runMigrations(db, migrations.filter(migration => migration.version <= 40))
  const database = db.raw
  database.run(
    'INSERT INTO customers (id, name) VALUES (?, ?)',
    ['customer-local-294', input.customerName],
  )
  database.run(
    'INSERT INTO suppliers (id, name, deleted_at) VALUES (?, ?, ?)',
    [
      'supplier-local-294',
      input.supplierName,
      options.withSoftDeletedSupplier ? input.deletedAt : null,
    ],
  )
  database.run(
    'INSERT INTO crews (id, name) VALUES (?, ?)',
    ['crew-local-294', '迁移验收班组'],
  )
  database.run(
    `INSERT INTO projects (
      id, name, customer_id, secondary_customer_id, area, contract_amount
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      'project-local-294',
      input.projectName,
      'customer-local-294',
      null,
      input.area,
      input.contractAmount,
    ],
  )
  database.run(
    `INSERT INTO workers (
      id, name, crew_id, current_project_id
    ) VALUES (?, ?, ?, ?)`,
    ['worker-local-294', '迁移验收工人', 'crew-local-294', 'project-local-294'],
  )
  database.run(
    `INSERT INTO project_suppliers (
      id, project_id, supplier_id
    ) VALUES (?, ?, ?)`,
    ['project-supplier-local-294', 'project-local-294', 'supplier-local-294'],
  )
  // 真实旧 schema 保留，业务图由夹具显式准备，不依赖迁移自带的默认工序。
  database.run('DELETE FROM schedule_process_library_tasks')
  database.run('DELETE FROM schedule_process_libraries')
  database.run(`INSERT INTO schedule_process_libraries
    (id, code, name, version, is_default, created_at, updated_at)
    VALUES (?, ?, ?, 1, 1, ?, ?)`, ['library-local-294', 'migration-library-294', input.libraryName, SOURCE_CREATED_AT, SOURCE_CREATED_AT])
  database.run(`INSERT INTO schedule_process_library_tasks
    (id, library_id, task_key, name, trade, duration_days, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 10, ?, ?)`, ['library-task-local-294', 'library-local-294', 'setting-out', '放线', '泥水工', input.durationDays, SOURCE_CREATED_AT, SOURCE_CREATED_AT])
  for (const table of ['customers', 'suppliers', 'crews', 'projects', 'workers', 'project_suppliers'])
    database.run(`UPDATE ${table} SET created_at = ?, updated_at = ?`, [SOURCE_CREATED_AT, SOURCE_CREATED_AT])
  const snapshot = database.export()
  database.close()
  return snapshot
}

async function installProductionSnapshot(page: Page, snapshot: Uint8Array) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('crm-new-browser')
      request.addEventListener('success', () => resolve(), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
      request.addEventListener('blocked', () => reject(new Error('browser database deletion blocked')), { once: true })
    })
  })
  await writeProductionSnapshot(page, snapshot)
}

async function localMigrationState(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('crm-new-browser', 2)
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
    })
    function read(storeName: string, key: string): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readonly')
        const request = transaction.objectStore(storeName).get(key)
        request.addEventListener('success', () => resolve(request.result), { once: true })
        request.addEventListener('error', () => reject(request.error), { once: true })
      })
    }
    async function digest(bytes: ArrayBuffer) {
      const hash = await crypto.subtle.digest('SHA-256', bytes)
      return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
    }
    try {
      const marker = await read('database_settings', 'active-core-migration')
      const readOnly = await read('database_settings', 'legacy-production-read-only')
      const production = await read('database_snapshots', 'production') as ArrayBuffer
      const backupKeys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const transaction = database.transaction('database_backups', 'readonly')
        const request = transaction.objectStore('database_backups').getAllKeys()
        request.addEventListener('success', () => resolve(request.result), { once: true })
        request.addEventListener('error', () => reject(request.error), { once: true })
      })
      const backupId = typeof backupKeys[0] === 'string' ? backupKeys[0] : null
      const backup = backupId
        ? await read('database_backups', backupId) as { snapshot: ArrayBuffer }
        : null
      return {
        marker,
        readOnly,
        production: await digest(production),
        backup: backup ? await digest(backup.snapshot) : null,
        backupId,
      }
    }
    finally {
      database.close()
    }
  })
}

test.describe('Issue #294：核心身份迁移与可回滚切换', () => {
  test.beforeEach(async ({ request, page }) => {
    await resetMigrationBackend(request)
    await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'false'))
    await page.clock.install({ time: new Date(MIGRATION_NOW) })
  })

  test.afterEach(async ({ request }) => {
    await resetMigrationBackend(request)
  })

  for (const input of MIGRATION_INPUTS) {
    test(`真实旧库快照 ${input.name} 经显式流程进入中央读链，刷新后仍可回滚`, async ({ page }) => {
      test.slow()
      await page.goto('/settings/data-migration')
      await expect(page.getByTestId('core-migration-page').getByRole('heading', { name: '本地数据迁移' }))
        .toBeVisible({ timeout: 60_000 })
      await installProductionSnapshot(page, await legacyProductionSnapshot(input))
      await reloadMigrationPage(page)

      await migrationCommand(page, '运行预检', '/api/migrations/core/preflight')
      await expect(page.getByText(`sqlite-v${LATEST_VERSION}`, { exact: true })).toBeVisible()

      await page.getByRole('button', { name: '创建不可变备份' }).click()
      await expect(page.getByText('不可变备份', { exact: true })).toBeVisible()
      const afterBackup = await localMigrationState(page)
      expect(afterBackup.backupId).toMatch(/^core-migration-[a-f0-9]{64}-[a-f0-9]{64}$/)
      expect(afterBackup.readOnly).not.toBe(true)
      expect(afterBackup.backup).toEqual(afterBackup.production)

      const dryRun = await migrationCommand(page, '执行 dry-run', '/api/migrations/core/dry-run')
      const dryRunBody = await dryRun.json() as CoreMigrationBatchDTO
      expect(dryRunBody.status).toBe('dry-run')
      await expect(page.getByText('对账通过，未发现迁移差异')).toBeVisible()

      const imported = await migrationCommand(page, '导入可导入记录', `/api/migrations/core/${dryRunBody.batchId}/import`)
      expect(await imported.json()).toMatchObject({ batchId: dryRunBody.batchId, status: 'applied' })
      await expect(page.getByText('客户 1 条')).toBeVisible()
      await expect(page.getByText('项目 1 条')).toBeVisible()

      const firstSnapshot = await page.evaluate(async () => {
        const response = await fetch('/api/migrations/core/snapshot')
        return await response.json() as CoreMigrationSnapshotDTO
      })
      const replay = await page.evaluate(async (batchId) => {
        const context = await (await fetch('/api/read/business-session')).json() as {
          workspaceId: string
          actorId: string
        }
        const response = await fetch(`/api/migrations/core/${batchId}/import`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            workspaceId: context.workspaceId,
            actorId: context.actorId,
            requiredCapability: 'core:migration:write',
            commandId: 'browser-import-replay',
            batchId,
          }),
        })
        return { ok: response.ok, body: await response.json() }
      }, dryRunBody.batchId)
      expect(replay.ok).toBe(true)
      const secondSnapshot = await page.evaluate(async () =>
        await (await fetch('/api/migrations/core/snapshot')).json() as typeof firstSnapshot,
      )
      expect(secondSnapshot.entities).toEqual(firstSnapshot.entities)
      const { project, customer } = expectCompleteGraph(secondSnapshot, input)

      const confirmed = await migrationCommand(page, '确认切换中央后台', `/api/migrations/core/${dryRunBody.batchId}/confirm`)
      expect(await confirmed.json()).toMatchObject({ batchId: dryRunBody.batchId, status: 'confirmed' })
      await expect(page.getByText('已切换中央后台')).toBeVisible()
      const confirmedLocal = await localMigrationState(page)
      expect(confirmedLocal.readOnly).toBe(true)
      expect(confirmedLocal.marker).toMatchObject({ batchId: dryRunBody.batchId })

      await reloadMigrationPage(page)
      await expect(page.getByText('已切换中央后台')).toBeVisible()
      await expect(page.getByRole('button', { name: '回滚到本地快照' })).toBeEnabled()

      await page.goto('/project')
      await expect(page.getByRole('link', { name: input.projectName, exact: true })).toBeVisible()
      const projectRead = await page.evaluate(async () => {
        const response = await fetch('/api/read/projects?includeDemo=false&page=1&pageSize=10')
        return await response.json() as {
          items: Array<{
            project: { id: string }
            customer: { id: string | null, label: string | null }
          }>
        }
      })
      expect(projectRead.items).toContainEqual(expect.objectContaining({
        project: expect.objectContaining({ id: project.id }),
        customer: expect.objectContaining({ id: customer.id, label: input.customerName }),
      }))

      await page.goto('/settings/data-migration')
      const rollback = await migrationCommand(page, '回滚到本地快照', `/api/migrations/core/${dryRunBody.batchId}/rollback`)
      expect(await rollback.json()).toMatchObject({ batchId: dryRunBody.batchId, status: 'rolled-back' })
      await expect(page.getByText('已回滚本地快照')).toBeVisible()
      const rolledBackLocal = await localMigrationState(page)
      expect(rolledBackLocal.readOnly).toBe(false)
      expect(rolledBackLocal.marker).toBeUndefined()
      expect(rolledBackLocal.production).toEqual(rolledBackLocal.backup)
      const afterRollback = await page.evaluate(async () =>
        await (await fetch('/api/read/projects?includeDemo=false&page=1&pageSize=10')).json() as {
          items: Array<{ project: { label: string } }>
        },
      )
      expect(afterRollback.items.map(item => item.project.label)).not.toContain(input.projectName)
    })
  }

  for (const [index, viewport] of VIEWPORTS.entries()) {
    const { width } = viewport
    test(`${width}px 迁移页只由对账表自身承载横向滚动`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/settings/data-migration')
      await expect(page.getByTestId('core-migration-page').getByRole('heading', { name: '本地数据迁移' }))
        .toBeVisible()
      const input = MIGRATION_INPUTS[index % MIGRATION_INPUTS.length]!
      await installProductionSnapshot(page, await legacyProductionSnapshot(input, { withSoftDeletedSupplier: true }))
      await reloadMigrationPage(page)
      await migrationCommand(page, '运行预检', '/api/migrations/core/preflight')
      await expect(page.getByText(`sqlite-v${LATEST_VERSION}`, { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '创建不可变备份' }).click()
      const dryRun = await migrationCommand(page, '执行 dry-run', '/api/migrations/core/dry-run')
      expect(await dryRun.json()).toMatchObject({ status: 'dry-run' })
      await expectSoftDeletedGraphs(page)
      const reconciliationScroll = page.getByTestId('migration-reconciliation-scroll')
      await expect(reconciliationScroll).toBeVisible()
      await expectLocalHorizontalScroll(reconciliationScroll, `${width}px 迁移对账表`)
      await reconciliationScroll.evaluate((element) => {
        element.scrollLeft = element.scrollWidth
      })
      expect(await reconciliationScroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
      await expectNoPageOverflow(page, `#294 核心身份迁移 @ ${width}px`)
    })
  }

  test('中央回滚后本地恢复失败时保留原批次并允许键盘重试', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/settings/data-migration')
    await expect(page.getByTestId('core-migration-page')).toBeVisible({ timeout: 60_000 })
    await installProductionSnapshot(page, await legacyProductionSnapshot(MIGRATION_INPUTS[1], { withSoftDeletedSupplier: true }))
    await reloadMigrationPage(page)
    await migrationCommand(page, '运行预检', '/api/migrations/core/preflight')
    await expect(page.getByText(`sqlite-v${LATEST_VERSION}`, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '创建不可变备份' }).click()
    const dryRun = await migrationCommand(page, '执行 dry-run', '/api/migrations/core/dry-run')
    const batch = await dryRun.json() as CoreMigrationBatchDTO
    expect(batch.status).toBe('dry-run')
    await expectSoftDeletedGraphs(page)
    const imported = await migrationCommand(page, '导入可导入记录', `/api/migrations/core/${batch.batchId}/import`)
    expect(await imported.json()).toMatchObject({ batchId: batch.batchId, status: 'applied' })
    const confirmed = await migrationCommand(page, '确认切换中央后台', `/api/migrations/core/${batch.batchId}/confirm`)
    expect(await confirmed.json()).toMatchObject({ batchId: batch.batchId, status: 'confirmed' })
    await expect(page.getByText('已切换中央后台', { exact: true })).toBeVisible()
    const protectedState = await localMigrationState(page)

    await page.evaluate(() => {
      const transaction = IDBDatabase.prototype.transaction
      IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
        const [stores, mode] = args
        const names = typeof stores === 'string' ? [stores] : [...stores]
        if (this.name === 'crm-new-browser' && mode === 'readwrite' && names.includes('database_snapshots')) {
          IDBDatabase.prototype.transaction = transaction
          throw new Error('测试：本地快照暂时无法恢复')
        }
        return transaction.apply(this, args)
      }
    })
    const rollback = page.getByRole('button', { name: '回滚到本地快照' })
    const rollbackReceipt = await migrationCommand(page, '回滚到本地快照', `/api/migrations/core/${batch.batchId}/rollback`)
    expect(await rollbackReceipt.json()).toMatchObject({ batchId: batch.batchId, status: 'rolled-back' })
    await expect(page.getByRole('alert').filter({ hasText: '测试：本地快照暂时无法恢复' })).toHaveText('测试：本地快照暂时无法恢复')
    await expect(page.getByText('中央已回滚，等待恢复本地快照', { exact: true })).toBeVisible()
    await expect(page.getByText('对账通过，未发现迁移差异')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '运行预检' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '执行 dry-run' })).toBeDisabled()
    const pendingState = await localMigrationState(page)
    expect(pendingState.marker).toEqual(protectedState.marker)
    expect(pendingState.backup).toEqual(protectedState.backup)
    expect(pendingState.readOnly).toBe(true)
    expect(pendingState.production).toEqual(protectedState.production)
    const central = await page.request.get('/api/migrations/core/snapshot')
    expect(await central.json()).toMatchObject({ authority: 'local', activeBatchId: null, entities: [] })

    for (const viewport of VIEWPORTS) {
      const { width } = viewport
      await page.setViewportSize(viewport)
      await page.getByText('中央已回滚，等待恢复本地快照', { exact: true }).scrollIntoViewIfNeeded()
      await expectNoPageOverflow(page, `迁移回滚待恢复 @ ${width}px`)
      if (process.env.CRM_EVIDENCE_DIR) {
        await mkdir(process.env.CRM_EVIDENCE_DIR, { recursive: true })
        await page.screenshot({ path: path.join(process.env.CRM_EVIDENCE_DIR, `migration-recovery-${width}.png`) })
      }
    }
    await rollback.focus()
    await rollback.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(rollback).toBeFocused()
    const retried = page.waitForResponse(response =>
      new URL(response.url()).pathname === `/api/migrations/core/${batch.batchId}/rollback`
        && response.request().method() === 'POST',
    )
    await rollback.press('Enter')
    const retryReceipt = await retried
    expect(retryReceipt.ok()).toBe(true)
    expect(await retryReceipt.json()).toMatchObject({ batchId: batch.batchId, status: 'rolled-back' })
    await expect(page.getByText('已回滚本地快照', { exact: true })).toBeVisible()
    const restored = await localMigrationState(page)
    expect(restored.marker).toBeUndefined()
    expect(restored.readOnly).toBe(false)
    expect(restored.production).toEqual(protectedState.backup)
  })
})
