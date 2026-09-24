import type { APIRequestContext, Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { LATEST_VERSION, migrations, runMigrations } from '../app/lib/db/migrations'
import { createMemoryDb } from '../tests/helpers/memory-db'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

async function resetMigrationBackend(request: APIRequestContext) {
  const response = await request.post('/api/testing/core-migration/reset', {
    headers: { 'x-ruihang-test-reset': '1' },
  })
  expect(response.ok()).toBe(true)
}

async function legacyProductionSnapshot(options: { withSoftDeletedSupplier?: boolean } = {}): Promise<Uint8Array> {
  const db = await createMemoryDb()
  await runMigrations(db, migrations.filter(migration => migration.version <= 40))
  const database = db.raw
  database.run(
    'INSERT INTO customers (id, name) VALUES (?, ?)',
    ['customer-local-294', '迁移验收客户'],
  )
  database.run(
    'INSERT INTO suppliers (id, name, deleted_at) VALUES (?, ?, ?)',
    [
      'supplier-local-294',
      '迁移验收分供方',
      options.withSoftDeletedSupplier ? '2026-08-15T08:00:00.000Z' : null,
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
      '迁移验收项目',
      'customer-local-294',
      null,
      125.5,
      8800,
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
  const snapshot = database.export()
  database.close()
  return snapshot
}

async function installProductionSnapshot(page: Page, snapshot: Uint8Array) {
  await page.evaluate(async (bytes) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('crm-new-browser')
      request.addEventListener('success', () => resolve(), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
      request.addEventListener('blocked', () => reject(new Error('browser database deletion blocked')), { once: true })
    })
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('crm-new-browser', 2)
      request.addEventListener('upgradeneeded', () => {
        for (const store of ['database_snapshots', 'database_backups', 'database_settings']) {
          if (!request.result.objectStoreNames.contains(store))
            request.result.createObjectStore(store)
        }
      })
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('database_snapshots', 'readwrite')
        transaction.objectStore('database_snapshots').put(new Uint8Array(bytes).buffer, 'production')
        transaction.addEventListener('complete', () => resolve(), { once: true })
        transaction.addEventListener('error', () => reject(transaction.error), { once: true })
        transaction.addEventListener('abort', () => reject(transaction.error), { once: true })
      })
    }
    finally {
      database.close()
    }
  }, [...snapshot])
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
        production: Array.from(new Uint8Array(production)),
        backup: backup
          ? Array.from(new Uint8Array(backup.snapshot))
          : null,
        backupId,
      }
    }
    finally {
      database.close()
    }
  })
}

test.describe('Issue #294：核心身份迁移与可回滚切换', () => {
  test.beforeEach(async ({ request }) => {
    await resetMigrationBackend(request)
  })

  test.afterEach(async ({ request }) => {
    await resetMigrationBackend(request)
  })

  test('真实旧库快照经显式流程进入中央读链，刷新后仍可回滚', async ({ page }) => {
    test.slow()
    await page.goto('/settings/data-migration')
    await expect(page.getByTestId('core-migration-page').getByRole('heading', { name: '本地数据迁移' }))
      .toBeVisible({ timeout: 60_000 })
    await installProductionSnapshot(page, await legacyProductionSnapshot())
    await page.reload()

    const preflightResponse = page.waitForResponse(response =>
      response.url().endsWith('/api/migrations/core/preflight')
      && response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '运行预检' }).click()
    expect((await preflightResponse).ok()).toBe(true)
    await expect(page.getByText(`sqlite-v${LATEST_VERSION}`, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: '创建不可变备份' }).click()
    await expect(page.getByText('不可变备份', { exact: true })).toBeVisible()
    const afterBackup = await localMigrationState(page)
    expect(afterBackup.backupId).toMatch(/^core-migration-[a-f0-9]{64}-[a-f0-9]{64}$/)
    expect(afterBackup.readOnly).not.toBe(true)

    const dryRunResponse = page.waitForResponse(response =>
      response.url().endsWith('/api/migrations/core/dry-run')
      && response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '执行 dry-run' }).click()
    const dryRun = await dryRunResponse
    expect(dryRun.ok()).toBe(true)
    const dryRunBody = await dryRun.json() as { batchId: string }
    await expect(page.getByText('对账通过，未发现迁移差异')).toBeVisible()

    await page.getByRole('button', { name: '导入可导入记录' }).click()
    await expect(page.getByText('客户 1 条')).toBeVisible()
    await expect(page.getByText('项目 1 条')).toBeVisible()

    const firstSnapshot = await page.evaluate(async () => {
      const response = await fetch('/api/migrations/core/snapshot')
      return await response.json() as { entities: Array<{ id: string, references: Record<string, string | null> }> }
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
    expect(secondSnapshot.entities).toHaveLength(6)
    const project = secondSnapshot.entities.find(entity =>
      entity.id.includes('projects'),
    )
    const customer = secondSnapshot.entities.find(entity =>
      entity.id.includes('customers'),
    )
    expect(project?.references.customerId).toBe(customer?.id)

    await page.getByRole('button', { name: '确认切换中央后台' }).click()
    await expect(page.getByText('已切换中央后台')).toBeVisible()
    const confirmedLocal = await localMigrationState(page)
    expect(confirmedLocal.readOnly).toBe(true)
    expect(confirmedLocal.marker).toMatchObject({ batchId: dryRunBody.batchId })

    await page.reload()
    await expect(page.getByText('已切换中央后台')).toBeVisible()
    await expect(page.getByRole('button', { name: '回滚到本地快照' })).toBeEnabled()

    await page.goto('/project')
    await expect(page.getByRole('link', { name: '迁移验收项目', exact: true })).toBeVisible()
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
      project: expect.objectContaining({ id: project?.id }),
      customer: expect.objectContaining({ id: customer?.id, label: '迁移验收客户' }),
    }))

    await page.goto('/settings/data-migration')
    await page.getByRole('button', { name: '回滚到本地快照' }).click()
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
    expect(afterRollback.items.map(item => item.project.label)).not.toContain('迁移验收项目')
  })

  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 迁移页只由对账表自身承载横向滚动`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.goto('/settings/data-migration')
      await expect(page.getByTestId('core-migration-page').getByRole('heading', { name: '本地数据迁移' }))
        .toBeVisible()
      await installProductionSnapshot(page, await legacyProductionSnapshot({ withSoftDeletedSupplier: true }))
      await page.reload()
      await page.getByRole('button', { name: '运行预检' }).click()
      await expect(page.getByText(`sqlite-v${LATEST_VERSION}`, { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '创建不可变备份' }).click()
      await page.getByRole('button', { name: '执行 dry-run' }).click()
      await expect(page.getByText('已保留软删除')).toBeVisible()
      const reconciliationScroll = page.getByTestId('migration-reconciliation-scroll')
      await expect(reconciliationScroll).toBeVisible()
      expect(await reconciliationScroll.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
      await expectNoPageOverflow(page, `#294 核心身份迁移 @ ${width}px`)
    })
  }

  test('中央回滚后本地恢复失败时保留原批次并允许键盘重试', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/settings/data-migration')
    await expect(page.getByTestId('core-migration-page')).toBeVisible({ timeout: 60_000 })
    await installProductionSnapshot(page, await legacyProductionSnapshot({ withSoftDeletedSupplier: true }))
    await page.reload()
    await page.getByRole('button', { name: '运行预检' }).click()
    await expect(page.getByText(`sqlite-v${LATEST_VERSION}`, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '创建不可变备份' }).click()
    await page.getByRole('button', { name: '执行 dry-run' }).click()
    await expect(page.getByText('已保留软删除', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '导入可导入记录' }).click()
    await page.getByRole('button', { name: '确认切换中央后台' }).click()
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
    await rollback.click()
    await expect(page.getByRole('alert')).toHaveText('测试：本地快照暂时无法恢复')
    await expect(page.getByText('中央已回滚，等待恢复本地快照', { exact: true })).toBeVisible()
    await expect(page.getByText('对账通过，未发现迁移差异')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '运行预检' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '执行 dry-run' })).toBeDisabled()
    const pendingState = await localMigrationState(page)
    expect(pendingState.marker).toEqual(protectedState.marker)
    expect(pendingState.backup).toEqual(protectedState.backup)
    const central = await page.request.get('/api/migrations/core/snapshot')
    expect(await central.json()).toMatchObject({ authority: 'local', activeBatchId: null })

    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
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
    await rollback.press('Enter')
    await expect(page.getByText('已回滚本地快照', { exact: true })).toBeVisible()
    const restored = await localMigrationState(page)
    expect(restored.marker).toBeUndefined()
    expect(restored.readOnly).toBe(false)
    expect(restored.production).toEqual(protectedState.backup)
  })
})
