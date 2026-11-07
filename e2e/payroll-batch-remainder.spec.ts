import type { CoreMigrationBatchDTO } from '../app/lib/migration/core-contract'
import type { PayrollAAction, PayrollACommandRead } from '../app/lib/payroll/central-a-contract'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { payrollC1Repository } from './helpers/payroll-c1-workspace'

test('真实三张工资从0暂缓到自动分完1000，五档视口及逐单冷读不超发', async ({ page }, info) => {
  test.setTimeout(180_000)
  const output = info.outputPath('batch-remainder-source.json')
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('e2e/helpers/payroll-batch-migration-source.ts'), output, randomUUID()])
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
  const projectId = mapped('projects', 'batch-project')
  const crewId = mapped('crews', 'batch-crew')
  const repository = payrollC1Repository(page)
  const query = { origin: 'real' as const, projectId, month: '2026-08' }
  const command = (read: PayrollACommandRead, action: PayrollAAction) => ({ commandId: randomUUID(), workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null, action })
  const statementIds: string[] = []
  for (let index = 0; index < 3; index++) {
    const leaderWorkerId = mapped('workers', `batch-worker-${index}`)
    const scope = { projectId, crewId, leaderWorkerId, month: query.month }
    const config = await repository.aConfig(query, scope)
    expect(config.priceOptions).toHaveLength(1)
    await repository.execute(command(config, { kind: 'save-a-prices', prices: [{ priceId: null, itemId: config.priceOptions[0]!.itemId, unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: query.month, unitPrice: 1000, scope: { kind: 'project' } }] }))
    const book = { bookPurpose: 'ordinary' as const, managementBookId: null }
    const initialDraft = { ...scope, book, memberWorkerIds: [leaderWorkerId], periodKind: 'monthly' as const, payRatio: 1, note: '自动分余真实验收' }
    const draftKey = randomUUID()
    const preview = await repository.aForm(query, { statementId: null, draftKey, draft: initialDraft })
    expect(preview.draft.ratioPlan?.itemRatios.length).toBeGreaterThan(0)
    const draft = { ...initialDraft, ratioPlan: { ...preview.draft.ratioPlan!, itemRatios: preview.draft.ratioPlan!.itemRatios.map(row => ({ ...row, ratio: 1 })) } }
    const form = await repository.aForm(query, { statementId: null, draftKey, draft })
    const saved = await repository.execute(command(form, { kind: 'save-a-draft', draft }))
    statementIds.push(saved.statementId!)
    const roundingScope = { projectId, leaderWorkerId, book, month: query.month }
    const rounding = await repository.aRounding(query, roundingScope)
    await repository.executeARounding({ schemaVersion: 1, commandId: randomUUID(), workspaceId: rounding.context.workspaceId, actorId: rounding.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: rounding.context.sourceVersion, scope: roundingScope, action: { kind: 'save-a-rounding', rule: { kind: 'floor', stepFen: 10_000 } } })
  }
  for (const statementId of statementIds)
    await repository.execute(command(await repository.aForm(query, { statementId }), { kind: 'check-a' }))
  await page.goto(`/subcontract/payroll?${new URLSearchParams({ origin: 'real', project: projectId, month: query.month })}`)
  const selection = page.getByRole('button', { name: '选择本期可处理工资', exact: true })
  await expect(selection).toBeVisible({ timeout: 60_000 })
  for (const name of ['甲负责人', '乙负责人', '丙负责人'])
    await page.getByRole('checkbox', { name: `选择 ${name} 的工资`, exact: true }).check()
  await page.getByRole('button', { name: '批量核对 / 资金（3）', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('本期资金总额（元）').fill('0')
  await dialog.getByRole('button', { name: '生成预览', exact: true }).click()
  await expect(dialog.getByRole('radio', { name: '暂缓', exact: true }).first()).toBeChecked()
  await expect(dialog.getByLabel('实际发放（元）')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: '批量核对 / 资金（3）', exact: true }).click()
  await dialog.getByLabel('本期资金总额（元）').fill('1000')
  await dialog.getByRole('button', { name: '生成预览', exact: true }).click()
  await expect(dialog.getByLabel('实际发放（元）')).toHaveCount(3)
  await expect(dialog).toContainText('建议合计：1000.00 元')
  await expect(dialog).toContainText('未分配：0.00 元')
  expect((await dialog.getByLabel('实际发放（元）').evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).value))).sort()).toEqual(['333.33', '333.33', '333.34'])
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 960 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    const bounds = await dialog.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    await dialog.getByLabel('实际发放（元）').first().focus()
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true)
  }
  await dialog.getByRole('button', { name: '固定批次计划', exact: true }).click()
  for (let index = 0; index < 3; index++)
    await dialog.getByRole('button', { name: '执行下一项', exact: true }).click()
  await expect(dialog).toContainText('批次已完成')
  expect((await repository.actualLedger(query, { projectId })).netAmount.value).toBe(1000)
  const list = await repository.list(query)
  expect(list.rows.filter(row => statementIds.includes(row.id)).map(row => row.actualAmount).sort()).toEqual([333.33, 333.33, 333.34])
})
