import type { Page, TestInfo } from '@playwright/test'
import type { CoreMigrationBatchDTO } from '../app/lib/migration/core-contract'
import type { PayrollC1Action, PayrollC1FormRead } from '../app/lib/payroll/central-c1-contract'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { createPayrollRepository } from '../app/lib/payroll/central-repository'

test.use({ actionTimeout: 15000 })
async function fixture(page: Page, info: TestInfo) {
  const sourceFile = info.outputPath('source.json')
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('e2e/helpers/payroll-c1-migration-source.ts'), sourceFile, randomUUID()])
  const { source, snapshotSha256, byteLength } = JSON.parse(await readFile(sourceFile, 'utf8'))
  const session = await (await page.request.get('/api/read/business-session')).json()
  const envelope = () => ({ workspaceId: session.workspaceId, actorId: session.actorId, commandId: randomUUID(), requiredCapability: 'core:migration:write' })
  const preflight = await page.request.post('/api/migrations/core/preflight', { data: { ...envelope(), source, backup: null } })
  expect(preflight.ok(), await preflight.text()).toBe(true)
  const dry = await page.request.post('/api/migrations/core/dry-run', { data: { ...envelope(), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength, createdAt: new Date().toISOString(), immutable: true } } })
  expect(dry.ok(), await dry.text()).toBe(true)
  const batch: CoreMigrationBatchDTO = await dry.json()
  for (const action of ['import', 'confirm']) {
    const response = await page.request.post(`/api/migrations/core/${batch.batchId}/${action}`, { data: { ...envelope(), batchId: batch.batchId } })
    expect(response.ok(), await response.text()).toBe(true)
  }
  const mapped = (entity: string, id: string) => batch.mappings.find(row => row.entityType === entity && row.legacyId === id)!.serverId!
  const projectId = mapped('projects', 'c1-live')
  const crewId = mapped('crews', 'c1-live-crew')
  const leader = mapped('workers', 'c1-live-leader')
  const zero = mapped('workers', 'c1-live-zero')
  const payroll = createPayrollRepository(async (path, options) => {
    const response = await page.request.fetch(path, { method: options?.method ?? 'GET', params: options?.query ? Object.fromEntries(Object.entries(options.query).map(([key, value]) => [key, String(value)])) : undefined, data: options?.body })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  })
  const matrix = await payroll.attendanceMatrix({ origin: 'real' }, { projectId, month: '2026-08', crewId })
  await payroll.executeAttendance({ commandId: randomUUID(), workspaceId: session.workspaceId, actorId: session.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: matrix.context.sourceVersion, projectId, scope: matrix.scope, action: { kind: 'upsert-attendance', record: { workerId: leader, crewId, workDate: '2026-08-01', hours: 8, overtimeHours: 0, workContent: '正式编号实际工资', note: '' } } })
  const draft = { projectId, crewId, leaderWorkerId: leader, memberWorkerIds: [leader, zero], month: '2026-08', note: '正式出具不重算原工资' }
  const command = (read: PayrollC1FormRead, action: PayrollC1Action) => payroll.executeC1({ commandId: randomUUID(), workspaceId: session.workspaceId, actorId: session.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId, statementId: read.statementId, draftKey: read.draftKey, configScope: null, action })
  const saved = await command(await payroll.c1Form({ origin: 'real' }, { statementId: null, draftKey: randomUUID(), draft }), { kind: 'save-c1-draft', draft })
  const form = () => payroll.c1Form({ origin: 'real' }, { statementId: saved.statementId! })
  await command(await form(), { kind: 'check-c1' })
  await command(await form(), { kind: 'release-c1', release: { actualAmount: 480, allocations: [{ workerId: leader, amount: 480 }, { workerId: zero, amount: 0 }] } })
  return { payroll, projectId, statementId: saved.statementId! }
}

test('原工资预览、人工起点、正式占号丢响应恢复、重复Excel和实际打印保持原号', async ({ page }, info) => {
  test.setTimeout(240000)
  const errors: string[] = []
  page.on('pageerror', cause => errors.push(cause.message))
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
    window.print = () => {
      (window as unknown as { officialPrints: number }).officialPrints = ((window as unknown as { officialPrints?: number }).officialPrints ?? 0) + 1
    }
  })
  const f = await fixture(page, info)
  await page.goto(`/subcontract/payroll/${f.statementId}?origin=real`)
  await expect(page.getByRole('link', { name: '预览 / 正式出具', exact: true })).toBeVisible({ timeout: 45000 })
  await page.getByRole('link', { name: '预览 / 正式出具', exact: true }).click()
  await expect(page.getByLabel('下一张正式编号', { exact: true })).toHaveValue('', { timeout: 30000 })
  await expect(page.getByRole('button', { name: '确认预览并正式出具', exact: true })).toBeDisabled()
  await page.getByLabel('下一张正式编号', { exact: true }).fill('128')
  await page.getByLabel('旧纸号核对依据', { exact: true }).fill('人工核对旧纸号至127，下一张128')
  await page.getByRole('button', { name: '登记项目起点', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认登记起点', exact: true }).click()
  await expect(page.getByText('已登记起点 128', { exact: false })).toBeVisible()
  let lost = false
  await page.route('**/api/commands/payroll-numbering', async (route) => {
    if (!lost && route.request().postDataJSON()?.action?.kind === 'issue') {
      lost = true
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ statusCode: 503, message: '验收：提交完成后响应丢失' }) })
    }
    else { await route.continue() }
  })
  await page.getByRole('button', { name: '确认预览并正式出具', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '正式出具', exact: true }).click()
  await expect(page.getByRole('button', { name: '核对原编号提交', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: '核对原编号提交', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '核对原编号提交', exact: true }).click()
  await expect(page.getByRole('button', { name: '核对原编号提交', exact: true })).toHaveCount(0)
  await expect(page.getByText('正式工资编号：128', { exact: true })).toBeVisible()
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 960 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await expect.poll(() => page.locator('.shell-workspace').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    if (width === 390) {
      const complete = page.getByRole('region', { name: '原工资明细', exact: true }).locator('summary')
      await complete.focus()
      await expect(complete).toBeFocused()
      await complete.press('Enter')
      await expect(complete.locator('..')).toHaveAttribute('open', '')
      await expect(page.getByRole('region', { name: '原工资明细', exact: true }).locator('details')).toContainText('¥481.00')
      await expect(page.getByRole('region', { name: '原工资明细', exact: true }).locator('details')).toContainText('60.125')
      await complete.press('Enter')
    }
    await page.screenshot({ path: info.outputPath(`official-${width}.png`), fullPage: true })
  }
  for (const index of [1, 2]) {
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载正式工资 Excel', exact: true }).click()
    const download = await downloading
    const path = info.outputPath(`official-${index}.xlsx`)
    await download.saveAs(path)
    expect(download.suggestedFilename()).toContain('正式128')
    const book = XLSX.read(await readFile(path), { type: 'buffer' })
    expect(XLSX.utils.sheet_to_json(book.Sheets['正式出具']!, { header: 1 })).toEqual(expect.arrayContaining([['正式工资编号', '128'], ['原工资身份', f.statementId], ['原实际发放', 480]]))
    expect(book.SheetNames).toContain('考勤表')
  }
  await page.getByRole('button', { name: '打印正式工资', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { officialPrints: number }).officialPrints)).toBe(1)
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(page.locator('.payroll-c1-print')).toBeVisible()
  await expect(page.locator('.payroll-c1-print').getByText('正式工资编号：128', { exact: true })).toHaveCount(2)
  await page.pdf({ path: info.outputPath('official-print.pdf'), printBackground: true, preferCSSPageSize: true })
  await page.emulateMedia({ media: 'screen' })
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  const final = await f.payroll.numbering({ origin: 'real' }, { projectId: f.projectId, statementId: f.statementId })
  expect(final.issue?.number).toBe('128')
  expect(final.settings?.nextNumber).toBe(129)
  expect(final.document?.actualAmount).toBe(480)
  await page.getByRole('button', { name: '返回原工资', exact: true }).last().click()
  await expect(page).toHaveURL(new RegExp(`/subcontract/payroll/${f.statementId}\\?origin=real`))
  expect(errors).toEqual([])
})
