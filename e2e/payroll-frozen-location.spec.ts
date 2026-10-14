import type { CoreMigrationBatchDTO } from '../app/lib/migration/core-contract'
import type { PayrollAAction, PayrollACommandRead } from '../app/lib/payroll/central-a-contract'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { payrollC1Repository } from './helpers/payroll-c1-workspace'

test('真实冻结楼层范围在预览、XLSX及分页打印一致，不补断层或改原金额', async ({ page }, info) => {
  test.setTimeout(240_000)
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }))
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const output = info.outputPath('location-source.json')
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('e2e/helpers/payroll-location-migration-source.ts'), output, randomUUID()])
  const { source, snapshotSha256, byteLength } = JSON.parse(await readFile(output, 'utf8'))
  const session = await (await page.request.get('/api/read/business-session')).json()
  const envelope = () => ({ workspaceId: session.workspaceId, actorId: session.actorId, commandId: randomUUID(), requiredCapability: 'core:migration:write' })
  const reset = await page.request.post('/api/testing/core-migration/reset', { headers: { 'x-ruihang-test-reset': '1' } })
  expect(reset.ok(), await reset.text()).toBe(true)
  const preflight = await page.request.post('/api/migrations/core/preflight', { data: { ...envelope(), source, backup: null } })
  expect(preflight.ok(), await preflight.text()).toBe(true)
  const dry = await page.request.post('/api/migrations/core/dry-run', { data: { ...envelope(), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } } })
  expect(dry.ok(), await dry.text()).toBe(true)
  const batch: CoreMigrationBatchDTO = await dry.json()
  for (const action of ['import', 'confirm']) {
    const response = await page.request.post(`/api/migrations/core/${batch.batchId}/${action}`, { data: { ...envelope(), batchId: batch.batchId } })
    expect(response.ok(), await response.text()).toBe(true)
  }
  const mapped = (entityType: string, legacyId: string) => batch.mappings.find(row => row.entityType === entityType && row.legacyId === legacyId)!.serverId!
  const projectId = mapped('projects', 'location-project')
  const leaderWorkerId = mapped('workers', 'location-worker')
  const repository = payrollC1Repository(page)
  const query = { origin: 'real' as const, projectId, month: '2026-08' }
  const command = (read: PayrollACommandRead, action: PayrollAAction) => ({ commandId: randomUUID(), workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null, action })
  const config = await repository.aConfig(query, { projectId, leaderWorkerId, crewId: null, month: query.month })
  await repository.execute(command(config, { kind: 'save-a-prices', prices: [{ priceId: null, itemId: config.priceOptions[0]!.itemId, unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: query.month, unitPrice: 100, scope: { kind: 'project' } }] }))
  const draft = { projectId, leaderWorkerId, crewId: null, memberWorkerIds: [leaderWorkerId], book: { bookPurpose: 'ordinary' as const, managementBookId: null }, month: query.month, periodKind: 'monthly' as const, payRatio: 1, note: '只列原责任完成，不能把房间分项认作整层收尾。' }
  const form = await repository.aForm(query, { statementId: null, draftKey: randomUUID(), draft })
  const statementId = (await repository.execute(command(form, { kind: 'save-a-draft', draft }))).statementId!
  await repository.execute(command(await repository.aForm(query, { statementId }), { kind: 'check-a' }))
  await repository.execute(command(await repository.aForm(query, { statementId }), { kind: 'release-a', release: { actualAmount: 2800, allocations: [{ workerId: leaderWorkerId, amount: 2800 }] } }))
  await page.goto(`/subcontract/payroll/${encodeURIComponent(statementId)}?origin=real`)
  const frozen = page.getByRole('region', { name: '冻结工资输出', exact: true })
  await expect(frozen).toContainText('3–14、16–24、26–31楼', { timeout: 60_000 })
  await expect(frozen).toContainText('二栋')
  await page.reload()
  await expect(frozen).toContainText('原冻结施工范围', { timeout: 60_000 })
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 960 })
    await frozen.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    const table = frozen.getByLabel('一栋 墙砖 原位置明细', { exact: true })
    await table.focus()
    expect(await table.evaluate(node => node === document.activeElement)).toBe(true)
    if (width === 390) {
      expect(await table.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true)
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => table.evaluate(node => node.scrollLeft)).toBeGreaterThan(0)
    }
    await frozen.getByRole('heading', { name: '原冻结施工范围', exact: true }).scrollIntoViewIfNeeded()
  }
  const download = page.waitForEvent('download')
  await frozen.getByRole('button', { name: '下载冻结工资表', exact: true }).click()
  const file = await download
  expect(file.suggestedFilename()).toContain('一栋')
  const path = info.outputPath('frozen-locations.xlsx')
  await file.saveAs(path)
  const workbook = XLSX.read(await readFile(path))
  expect(XLSX.utils.sheet_to_json(workbook.Sheets.原施工范围!)).toHaveLength(28)
  expect(XLSX.utils.sheet_to_json(workbook.Sheets.发放汇总!)).toEqual([expect.objectContaining({ 本次实际发放: 2800 })])
  await page.emulateMedia({ media: 'print' })
  const pdf = await page.pdf({ path: info.outputPath('frozen-locations.pdf'), printBackground: true, preferCSSPageSize: true })
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const printed = await getDocument({ data: new Uint8Array(pdf) }).promise
  const texts: string[] = []
  for (let index = 1; index <= printed.numPages; index++) {
    const content = await (await printed.getPage(index)).getTextContent()
    texts.push(content.items.flatMap(item => 'str' in item ? [item.str] : []).join(''))
  }
  const text = texts.join('').normalize('NFKC').replace(/‒/g, '–').replace(/\s+/g, '')
  for (const expected of ['3–14、16–24、26–31楼', '二栋', '3101', '2,800.00', '签字确认并按手印', '现场负责人'])
    expect(text).toContain(expected)
  await writeFile(info.outputPath('print-validation.json'), JSON.stringify({ pages: printed.numPages, texts }, null, 2))
  await printed.destroy()
  expect(pageErrors).toEqual([])
})
