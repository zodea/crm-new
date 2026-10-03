import type { Page, TestInfo } from '@playwright/test'
import type { CoreMigrationBatchDTO } from '../../app/lib/migration/core-contract'
import type { PayrollAAction, PayrollACommandRead } from '../../app/lib/payroll/central-a-contract'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect } from '@playwright/test'
import { createQuantityRepository } from '../../app/lib/quantity/central-repository'
import { payrollC2Repository } from './payroll-c2-workspace'

export async function payrollHollowWorkspace(page: Page, info: TestInfo) {
  const output = info.outputPath('hollow-base-source.json')
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('e2e/helpers/payroll-hollow-migration-source.ts'), output, randomUUID()])
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
  await writeFile(info.outputPath('hollow-migration-batch.json'), JSON.stringify(batch, null, 2))
  const mapped = (entityType: string, legacyId: string) => batch.mappings.find(row => row.entityType === entityType && row.legacyId === legacyId)!.serverId!
  const projectId = mapped('projects', 'hollow-browser')
  const crewId = mapped('crews', 'hollow-crew')
  const leaderWorkerId = mapped('workers', 'hollow-leader')
  const zeroWorkerId = mapped('workers', 'hollow-zero')
  const repository = payrollC2Repository(page)
  const quantity = createQuantityRepository(async (path, options) => {
    const response = await page.request.fetch(path, { method: options?.method || 'GET', params: options?.query ? Object.fromEntries(Object.entries(options.query).map(([key, value]) => [key, String(value)])) : undefined, data: options?.body })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  })
  const query = { origin: 'real' as const }
  const command = (read: PayrollACommandRead, action: PayrollAAction) => ({ commandId: randomUUID(), workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null, action })
  const scope = { projectId, crewId, leaderWorkerId, month: '2026-08' }
  const config = await repository.aConfig(query, { ...scope, month: '2026-07' })
  await repository.execute(command(config, { kind: 'save-a-prices', prices: config.priceOptions.map(item => ({ priceId: null, itemId: item.itemId, unit: item.unit, mode: 'baseline', workerId: null, effectiveMonth: '2026-07', unitPrice: 10, scope: { kind: 'project' } })) }))
  const currentConfig = await repository.aConfig(query, scope)
  const currentItems = currentConfig.priceOptions.filter(item => !currentConfig.prices.some(price => price.itemId === item.itemId))
  if (currentItems.length)
    await repository.execute(command(currentConfig, { kind: 'save-a-prices', prices: currentItems.map(item => ({ priceId: null, itemId: item.itemId, unit: item.unit, mode: 'baseline', workerId: null, effectiveMonth: scope.month, unitPrice: 10, scope: { kind: 'project' } })) }))
  const region = await quantity.region({ projectId, origin: 'real', includeDemo: false })
  const east = region.data.units.find(unit => unit.code === '3701')!
  const west = region.data.units.find(unit => unit.code === '3702')!
  expect(east?.id).toBeTruthy()
  expect(west?.id).toBeTruthy()
  const unitPath = (unitId: string) => `/subcontract/quantity/${encodeURIComponent(projectId)}/${encodeURIComponent(unitId)}`
  const hollowRead = (unitId: string) => quantity.hollow({ projectId, unitId, origin: 'real', includeDemo: false })
  return { repository, quantity, query, command, scope, zeroWorkerId, east, west, unitPath, hollowRead }
}
