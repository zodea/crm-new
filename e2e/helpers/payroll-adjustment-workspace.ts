import type { Page, TestInfo } from '@playwright/test'
import type { CoreMigrationBatchDTO } from '../../app/lib/migration/core-contract'
import type { PayrollC2Action, PayrollC2CommandRead } from '../../app/lib/payroll/central-c2-contract'
import type { TargetCostFormRead } from '../../app/lib/target-cost/central-contract'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect } from '@playwright/test'
import { decodeTargetCostRead, encodeTargetCostWire } from '../../app/lib/target-cost/central-codec'
import { payrollC2Repository } from './payroll-c2-workspace'

/** 真实 SQLite 身份接管后经 HTTP 建立工资；不注入已确认快照。 */
export async function payrollAdjustmentWorkspace(page: Page, info: TestInfo) {
  const output = info.outputPath('source.json')
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('e2e/helpers/payroll-c2-migration-source.ts'), output, randomUUID()])
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
  const mapped = (entityType: string, legacyId: string) => batch.mappings.find(row => row.entityType === entityType && row.legacyId === legacyId)!.serverId!
  const projectId = mapped('projects', 'c2-live')
  const crewId = mapped('crews', 'c2-live-crew')
  const workerId = mapped('workers', 'c2-live-leader')
  const zeroId = mapped('workers', 'c2-live-zero')
  const repository = payrollC2Repository(page)
  const query = { origin: 'real' as const }
  const c2Command = (read: PayrollC2CommandRead, action: PayrollC2Action) => ({ commandId: randomUUID(), workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null, configId: 'scope' in read ? read.config?.id ?? null : null, action })
  await repository.executeC2(c2Command(await repository.c2Config(query, { projectId, leaderWorkerId: workerId }), { kind: 'save-c2-config', config: { crewId, unitRate: 1000, ruleText: '' } }))
  async function checked(month: string) {
    const record = { projectId, crewId, workerId, workDate: `${month}-01`, workContent: 'P4 实际现场签工', startTime: '08:00', endTime: '17:00', laborUnits: 1, witness: '现场证明', confirmedOn: `${month}-01`, status: 'confirmed' as const, note: '' }
    const daywork = await repository.dayworkForm(query, { recordId: null, draftKey: randomUUID(), draft: record })
    await repository.executeDaywork({ commandId: randomUUID(), workspaceId: daywork.context.workspaceId, actorId: daywork.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: daywork.context.sourceVersion, projectId, recordId: null, draftKey: daywork.draftKey, originalScope: null, action: { kind: 'save-daywork', record } })
    const draft = { projectId, crewId, leaderWorkerId: workerId, memberWorkerIds: [workerId, zeroId], month, note: '' }
    const form = await repository.c2Form(query, { statementId: null, draftKey: randomUUID(), draft })
    const saved = await repository.executeC2(c2Command(form, { kind: 'save-c2-draft', draft }))
    const statementId = saved.statementId!
    await repository.executeC2(c2Command(await repository.c2Form(query, { statementId }), { kind: 'check-c2' }))
    return statementId
  }
  const statementId = await checked('2026-08')
  await repository.executeC2(c2Command(await repository.c2Form(query, { statementId }), { kind: 'release-c2', release: { actualAmount: 1000, allocations: [{ workerId, amount: 1000 }, { workerId: zeroId, amount: 0 }] } }))
  async function createBudget() {
    const draftKey = randomUUID()
    const response = await page.request.get('/api/read/target-costs/form', { params: { origin: 'real', draftKey } })
    expect(response.ok(), await response.text()).toBe(true)
    const form = decodeTargetCostRead<TargetCostFormRead>(await response.json(), 'form', query, null)
    const saved = await page.request.post('/api/commands/target-costs', { data: encodeTargetCostWire({ ...form.context, requiredCapability: 'target-cost:write', commandId: randomUUID(), targetCostId: null, draftKey, action: { kind: 'save-header', saveAction: 'save', draft: { projectId, name: 'P4 工资同源预算', isBaseline: true } } }) })
    expect(saved.ok(), await saved.text()).toBe(true)
    return (await saved.json()).id as string
  }
  return { repository, query, projectId, crewId, workerId, zeroId, statementId, checked, c2Command, createBudget }
}
