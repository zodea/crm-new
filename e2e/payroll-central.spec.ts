import type { Page, TestInfo } from '@playwright/test'
import type { CoreMigrationBatchDTO } from '../app/lib/migration/core-contract'
import type { PayrollDetailRead, PayrollListRead } from '../app/lib/payroll/central-contract'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { decodePayrollRead } from '../app/lib/payroll/central-codec'

test.use({ actionTimeout: 15_000 })
async function capture(page: Page, info: TestInfo, name: string, focus?: string, horizontal?: string) {
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 960 })
    if (focus) {
      const element = page.locator(focus).first()
      await element.evaluate(node => node.scrollIntoView({ block: 'center' }))
      await expect(element).toBeInViewport()
    }
    if (horizontal) {
      const scroller = page.locator(horizontal).locator('.vxe-table--body-inner-wrapper').first()
      await scroller.evaluate((node) => {
        node.scrollLeft = node.scrollWidth - node.clientWidth
      })
      if (width < 1024)
        await expect.poll(() => scroller.evaluate(node => node.scrollLeft)).toBeGreaterThan(0)
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true, animations: 'disabled' })
  }
  await page.setViewportSize({ width: 1440, height: 960 })
}
async function fixture(page: Page, info: TestInfo) {
  const runId = randomUUID()
  const output = info.outputPath('payroll-source.json')
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('e2e/helpers/payroll-migration-source.ts'), output, runId])
  const prepared = JSON.parse(await readFile(output, 'utf8'))
  const { source, snapshotSha256, byteLength } = prepared
  const session = await (await page.request.get('/api/read/business-session')).json()
  const envelope = () => ({ workspaceId: session.workspaceId, actorId: session.actorId, commandId: randomUUID(), requiredCapability: 'core:migration:write' })
  const preflight = await page.request.post('/api/migrations/core/preflight', { data: { ...envelope(), source, backup: null } })
  expect(preflight.ok(), await preflight.text()).toBe(true)
  const dry = await page.request.post('/api/migrations/core/dry-run', { data: { ...envelope(), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength, createdAt: new Date().toISOString(), immutable: true } } })
  expect(dry.ok(), await dry.text()).toBe(true)
  const batch: CoreMigrationBatchDTO = await dry.json()
  for (const action of ['import', 'confirm']) {
    const result = await page.request.post(`/api/migrations/core/${batch.batchId}/${action}`, { data: { ...envelope(), batchId: batch.batchId } })
    expect(result.ok(), await result.text()).toBe(true)
  }
  const response = await page.request.get('/api/read/payroll', { params: { origin: 'real' } })
  expect(response.ok(), await response.text()).toBe(true)
  const list = decodePayrollRead<PayrollListRead>(await response.json(), 'list', { origin: 'real' })
  const get = (legacyId: string) => {
    const row = list.rows.find(row => row.legacyId === legacyId)
    expect(row, `原工资身份 ${legacyId} 必须可追溯`).toBeTruthy()
    return row!
  }
  const healthy = get(prepared.healthyStatementId)
  const projectId = batch.mappings.find(row => row.entityType === 'projects' && row.legacyId === 'pay-independent')?.serverId
  expect(projectId).toBeTruthy()
  const value = { runId, healthy, partial: get('pay-c2'), retired: get('pay-b'), retiredOtherStates: [get('pay-b-draft'), get('pay-b-checked')], invalid: get('pay-invalid'), missing: get('pay-missing'), independent: projectId!, healthySnapshot: prepared.healthySnapshot, list, sourceHash: source.sourceHash, snapshotSha256, byteLength, batchId: batch.batchId }
  await writeFile(info.outputPath('payroll-identities.json'), JSON.stringify(value))
  return value
}
async function readDetail(page: Page, id: string) {
  const response = await page.request.get(`/api/read/payroll/${encodeURIComponent(id)}`, { params: { origin: 'real' } })
  expect(response.ok(), await response.text()).toBe(true)
  return decodePayrollRead<PayrollDetailRead>(await response.json(), 'detail', { origin: 'real' }, id)
}

test('工资真实八表迁入、完整发放记录、独立来源、缺坏快照与退休历史只读往返', async ({ page }, info) => {
  test.setTimeout(360_000)
  const f = await fixture(page, info)
  const query = new URLSearchParams({ origin: 'real', project: f.healthy.projectId, month: '2026-08', crew: f.healthy.crewId!, status: 'released', format: 'C2' })
  const list = `/subcontract/payroll?${query}`
  await page.goto(list)
  await expect(page.getByRole('heading', { name: '工资台账', exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('link', { name: '2026-08', exact: true })).toHaveCount(1)
  await capture(page, info, 'filtered-payroll-list')
  await page.getByRole('link', { name: '2026-08', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '工资历史详情', exact: true })).toBeVisible()
  const detail = await readDetail(page, f.healthy.id)
  expect(detail.statement.snapshot.state).toBe('complete')
  expect(detail.statement.snapshot.raw).toBe(f.healthySnapshot)
  expect(detail.statement.allocations.map(row => row.amount)).toEqual([300, 0])
  await expect(page.locator('[aria-label="工资金额与状态"]')).toContainText('冻结时负责人')
  await expect(page.locator('[aria-label="工资金额与状态"]')).not.toContainText('当前已改名负责人')
  await capture(page, info, 'healthy-frozen-detail')
  await page.getByText('查看完整发放记录内容', { exact: true }).click()
  await expect(page.locator('[aria-label="发放快照证据"] pre').last()).toContainText('冻结时人工确认规则')
  await capture(page, info, 'complete-snapshot-evidence', '[aria-label="发放快照证据"]')
  await capture(page, info, 'zero-member-allocation', '[aria-label="收款分配"]')
  await page.reload()
  await expect(page.locator('[aria-label="工资金额与状态"]')).toContainText('冻结时负责人')
  await page.getByRole('link', { name: '查看本月来源', exact: true }).click()
  await expect(page.getByRole('heading', { name: '工资来源', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '月份与签工占用', exact: true }).click()
  await expect(page.locator('[aria-label="已保存的月份与签工占用"]')).toContainText('当月已有发放记录')
  await capture(page, info, 'frozen-month-occupation', '[aria-label="已保存的月份与签工占用"]', '[aria-label="已保存的月份与签工占用"]')
  await page.getByRole('link', { name: '返回工资记录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '工资历史详情', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '返回工资台账', exact: true }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('released')
  await expect.poll(() => new URL(page.url()).searchParams.get('crew')).toBe(f.healthy.crewId)

  await test.step('没有工资单的项目也能查询来源、真零及未领用签工', async () => {
    const sourcePath = `/subcontract/payroll/sources?origin=real&project=${encodeURIComponent(f.independent)}`
    await page.goto(sourcePath)
    await expect(page.getByRole('region', { name: '工资配置', exact: true })).toBeVisible()
    await capture(page, info, 'independent-source-configuration')
    await page.getByRole('button', { name: '考勤记录', exact: true }).click()
    await expect(page.locator('[aria-label="独立考勤记录"]')).toContainText('2026-07-02')
    await capture(page, info, 'independent-attendance-zero', '[aria-label="独立考勤记录"]')
    await page.getByRole('button', { name: '签工记录', exact: true }).click()
    await expect(page.getByRole('region', { name: '独立签工记录', exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: '签工确认状态', exact: true }).selectOption('draft')
    await expect(page.locator('[aria-label="独立签工记录"]')).toContainText('2026-08-02')
    await capture(page, info, 'independent-daywork-draft', '[aria-label="独立签工记录"]', '[aria-label="独立签工记录"]')
    await page.reload()
    await expect(page.getByRole('combobox', { name: '签工确认状态', exact: true })).toHaveValue('draft')
    await expect(page.locator('[aria-label="独立签工记录"]')).toContainText('2026-08-02')
  })
  for (const [name, row] of [['partial-snapshot', f.partial], ['retired-b-history', f.retired], ['invalid-snapshot', f.invalid], ['missing-snapshot', f.missing]] as const) {
    await page.goto(`/subcontract/payroll/${encodeURIComponent(row.id)}?origin=real`)
    await expect(page.getByRole('heading', { name: '工资历史详情', exact: true })).toBeVisible()
    const current = await readDetail(page, row.id)
    expect(current.statement.snapshot.state).not.toBe('complete')
    if (row.id !== f.partial.id) {
      await expect(page.locator('[aria-label="工资金额与状态"]')).toContainText('实际发放未记录')
      expect(current.statement.stored.head.actual_amount).toBe(100)
    }
    await capture(page, info, name)
    expect(await page.getByRole('button', { name: /发放|核对|打印|导出/ }).count()).toBe(0)
  }
  await page.getByText('查看原表与关系历史', { exact: true }).click()
  await page.getByText('查看工资头原始记录', { exact: true }).click()
  await expect(page.locator('[aria-label="原关系历史"] pre').first()).toContainText('100')
  await expect(page.locator('[aria-label="原工资头业务记录"]')).toContainText('100.00')
  await capture(page, info, 'missing-snapshot-original-head', '[aria-label="原工资头业务记录"]')
  await page.getByText('查看迁入原始记录', { exact: true }).click()
  await page.locator('[aria-label="迁入工资原始记录"]').getByText('工资头原文', { exact: true }).click()
  await expect(page.locator('[aria-label="迁入工资原始记录"]').getByText('工资头原文', { exact: true }).locator('..').locator('pre')).toContainText('pay-b')
  await capture(page, info, 'isolated-original-records', '[aria-label="迁入工资原始记录"]')
  for (const row of f.retiredOtherStates) {
    await page.goto(`/subcontract/payroll/${encodeURIComponent(row.id)}?origin=real`)
    await expect(page.locator('[aria-label="隔离工资历史"]')).toContainText('已退役')
    const original = await readDetail(page, row.id)
    expect(original.statement.status).toBe(row.status)
    expect(original.statement.formatFamily).toBe('B')
    await expect(page.getByRole('button', { name: /发放|核对|打印|导出/ })).toHaveCount(0)
  }
  await page.goto(`/subcontract/payroll/not-found?origin=real&project=${encodeURIComponent(f.independent)}`)
  await expect(page.getByRole('alert')).toBeVisible()
  await capture(page, info, 'missing-record-no-fallback')
  await page.goto(`/subcontract/payroll/${encodeURIComponent(f.healthy.id)}?origin=demo`)
  await expect(page.getByRole('alert')).toContainText(/演示.*权限|演示.*开启|演示.*授权|正式工资不能回退/)
  await capture(page, info, 'demo-origin-rejected')
  await page.goto('/subcontract/payroll/new?origin=real')
  await expect(page.getByRole('heading', { name: '工资建单暂未开放', exact: true })).toBeVisible()
  await expect(page.locator('main input')).toHaveCount(0)
  await capture(page, info, 'new-route-readonly-guard')
  const final = await readDetail(page, f.healthy.id)
  expect(final).toEqual(detail)
  await writeFile(info.outputPath('verification.json'), JSON.stringify({ runId: f.runId, batchId: f.batchId, sourceHash: f.sourceHash, statementId: f.healthy.id, snapshotUnchanged: true, newWrites: 0, resets: 0, scope: '真实SQLite预检、演练、迁入、确认后的一次完整只读浏览器旅程', widths: [390, 768, 1024, 1280, 1440] }, null, 2))
})
