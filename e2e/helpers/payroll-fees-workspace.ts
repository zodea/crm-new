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
import { payrollC2Repository } from './payroll-c2-workspace'

/** 只通过迁入基础事实及公开 HTTP 配置原工资价；费用/管理关系由界面建立。 */
export async function payrollFeesWorkspace(page: Page, info: TestInfo) {
  const output = info.outputPath('fees-source.json')
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('e2e/helpers/payroll-fees-migration-source.ts'), output, randomUUID()])
  const { source, snapshotSha256, byteLength } = JSON.parse(await readFile(output, 'utf8'))
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
  await writeFile(info.outputPath('fees-migration-batch.json'), JSON.stringify(batch, null, 2))
  const mapped = (entityType: string, legacyId: string) => batch.mappings.find(row => row.entityType === entityType && row.legacyId === legacyId)!.serverId!
  const repository = payrollC2Repository(page)
  const query = { origin: 'real' as const }
  const command = (read: PayrollACommandRead, action: PayrollAAction) => ({ commandId: randomUUID(), workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId: 'scope' in read ? read.scope.projectId : read.draft.projectId!, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null, action })
  async function project(legacyId: 'fee-ordinary' | 'fee-management') {
    const projectId = mapped('projects', legacyId)
    const crewId = mapped('crews', 'fee-crew')
    const leaderWorkerId = mapped('workers', `${legacyId}-leader`)
    const zeroId = mapped('workers', `${legacyId}-zero`)
    const scope = { projectId, crewId, leaderWorkerId, month: '2026-07' }
    const config = await repository.aConfig(query, scope)
    const items = Object.fromEntries(config.priceOptions.map(item => [item.itemName!, item.itemId]))
    await repository.execute(command(config, { kind: 'save-a-prices', prices: config.priceOptions.map(item => ({ priceId: null, itemId: item.itemId, unit: item.unit, mode: 'baseline', workerId: null, effectiveMonth: '2026-07', unitPrice: item.itemName === '墙砖' ? 36 : 0, scope: { kind: 'project' } })) }))
    const configPath = (month = '2026-07') => `/subcontract/payroll/config?${new URLSearchParams({ origin: 'real', project: projectId, crew: crewId, leader: leaderWorkerId, month })}`
    async function saveOrdinary(month = '2026-07') {
      const draft = { ...scope, month, periodKind: 'monthly' as const, memberWorkerIds: [leaderWorkerId, zeroId], payRatio: 1, note: '真实普通工资与管理费分别核对', book: { bookPurpose: 'ordinary' as const, managementBookId: null } }
      const form = await repository.aForm(query, { statementId: null, draftKey: randomUUID(), draft })
      return (await repository.execute(command(form, { kind: 'save-a-draft', draft }))).statementId!
    }
    return { ...scope, zeroId, items, configPath, saveOrdinary }
  }
  return { repository, query, command, project }
}
