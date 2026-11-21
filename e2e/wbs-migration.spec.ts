import type { CoreMigrationBatchDTO } from '../app/lib/migration/core-contract'
import type { ScheduleAction, ScheduleRead } from '../app/lib/schedule/central-contract'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'

test('完整旧 WBS 经真实 HTTP 接管，冻结绑定历史与冷读一致，重复确认保更正，独立新组阻止危险恢复', { tag: '@migration' }, async ({ request }, info) => {
  test.setTimeout(120_000)
  const reset = () => request.post('/api/testing/core-migration/reset', { headers: { 'x-ruihang-test-reset': '1' } })
  expect((await reset()).ok()).toBe(true)
  const output = info.outputPath('wbs-migration-source.json')
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('e2e/helpers/wbs-migration-source.ts'), output])
  const { source, snapshotSha256, byteLength } = JSON.parse(await readFile(output, 'utf8'))
  try {
    const session = await (await request.get('/api/read/business-session')).json()
    const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, commandId, requiredCapability: 'core:migration:write' })
    const preflight = await request.post('/api/migrations/core/preflight', { data: { ...envelope('wbs-http-preflight'), source, backup: null } })
    expect(preflight.ok(), await preflight.text()).toBe(true)
    const dry = await request.post('/api/migrations/core/dry-run', { data: { ...envelope('wbs-http-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } } })
    expect(dry.ok(), await dry.text()).toBe(true)
    const batch: CoreMigrationBatchDTO = await dry.json()
    expect(batch.issues.filter(row => ['apply-failed', 'missing-relation', 'orphan'].includes(row.metricKey))).toEqual([])
    expect(batch.issues).toContainEqual(expect.objectContaining({ entityType: 'wbs_projects', metricKey: 'legacy-audit', actualValue: 1 }))
    const transition = async (action: string) => {
      const response = await request.post(`/api/migrations/core/${batch.batchId}/${action}`, { data: { ...envelope(randomUUID()), batchId: batch.batchId } })
      expect(response.ok(), await response.text()).toBe(true)
      return response.json()
    }
    await transition('import')
    await transition('confirm')
    const mapped = (type: string, legacyId: string) => batch.mappings.find(row => row.entityType === type && row.legacyId === legacyId)!.serverId
    const projectId = mapped('projects', 'q-project')
    const namespace = mapped('wbs_projects', 'q-project')
    const quantity = mapped('quantity_projects', 'q-project')
    const query = { projectId, origin: 'real', includeDemo: false }
    const read = async (): Promise<ScheduleRead> => {
      const response = await request.get('/api/read/schedule/workspace', { params: query })
      expect(response.ok(), await response.text()).toBe(true)
      return response.json()
    }
    const imported = await read()
    const group = imported.snapshot.groups.find(row => row.id === `${namespace}:schedule_groups:wbs-group`)!
    const task = group.tasks.find(row => row.id === `${namespace}:schedule_tasks:wbs-task`)!
    expect(group).toMatchObject({ scopeBasis: 'contract', contractId: mapped('construction_contracts', 'q-contract'), processLibraryVersion: 3 })
    expect(task).toMatchObject({ baselineStart: '2026-08-30', baselineFinish: '2026-09-01', hasQty: true, stageId: `${quantity}:construction_stages:q-stage` })
    expect(task.floorPlans[0]).toMatchObject({ sourceBasis: 'provisional', provisionalQty: 8, isManual: true, legacyQuantityDetailMissing: true })
    expect(imported.snapshot.disabledDependencies).toContainEqual(expect.objectContaining({ id: `${namespace}:task_dependencies:wbs-dep`, lagDays: 1 }))
    expect(imported.history.removedTasks).toContainEqual(expect.objectContaining({ name: '无组旧删除任务', groupId: null }))
    const binding = imported.history.logs.find(row => row.operator === 'schedule:bind-contract')!
    expect(JSON.parse(binding.beforeJson!)).toMatchObject({ contract_id: null, scope_basis: 'provisional' })
    expect(JSON.parse(binding.afterJson!)).toMatchObject({ contract_id: group.contractId, scope_basis: 'contract' })
    expect(imported.history.migrationEvidence[0]).toMatchObject({ provisionalDetailStatus: 'legacy-detail-unavailable' })
    expect(await read()).toEqual(imported)
    const command = async (action: ScheduleAction, current: ScheduleRead) => {
      const response = await request.post('/api/commands/schedule', { data: { workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'schedule:write', commandId: randomUUID(), origin: 'real', projectId, sourceVersion: current.sourceVersion, action } })
      expect(response.ok(), await response.text()).toBe(true)
      return response.json()
    }
    await command({ kind: 'update-task', taskId: `${namespace}:schedule_tasks:wbs-manual`, patch: { manualProgress: 0.65 } }, imported)
    await transition('confirm')
    const corrected = await read()
    expect(corrected.snapshot.groups[0]!.tasks.find(row => row.id === `${namespace}:schedule_tasks:wbs-manual`)!.manualProgress).toBe(0.65)
    const beforeCompletion = await (await request.get('/api/read/quantity/completion', { params: { ...query, unitId: `${quantity}:units:q-unit` } })).json()
    const libraries = await (await request.get('/api/read/process-libraries', { params: { origin: 'real' } })).json()
    const library = libraries.libraries.find((row: { id: string }) => row.id === mapped('process_libraries', 'wbs-library'))
    expect(library.usageCount).toBe(1)
    await command({ kind: 'create-group', draft: { projectId, scopeBasis: 'contract', contractId: group.contractId, processLibraryId: library.id, librarySourceVersion: library.sourceVersion, name: '中央独立新建合同组', buildingIds: [`${quantity}:buildings:wbs-contract-building`], startDate: '2026-09-12', overlapMode: 'seq', tasks: [{ templateKey: 'paint', durationDays: 3, enabled: true, anchorStart: null }] } }, corrected)
    const afterCreation = await read()
    expect(afterCreation.snapshot.groups).toHaveLength(2)
    const rollback = await request.post(`/api/migrations/core/${batch.batchId}/rollback`, { data: { ...envelope('wbs-http-dangerous-rollback'), batchId: batch.batchId } })
    expect(rollback.status()).toBe(409)
    expect(await read()).toEqual(afterCreation)
    const afterCompletion = await (await request.get('/api/read/quantity/completion', { params: { ...query, unitId: `${quantity}:units:q-unit` } })).json()
    expect(afterCompletion.data).toEqual(beforeCompletion.data)
    expect(afterCompletion.sourceVersion).toBe(beforeCompletion.sourceVersion)
    const afterLibraries = await (await request.get('/api/read/process-libraries', { params: { origin: 'real' } })).json()
    expect(afterLibraries.libraries.find((row: { id: string }) => row.id === library.id).usageCount).toBe(2)
  }
  finally { expect((await reset()).ok()).toBe(true) }
})
