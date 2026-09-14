import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import { expect, it } from 'vitest'
import { WORKER_WRITE_CAPABILITY } from '../../app/lib/crew-worker/command-contract'
import { CORE_MIGRATION_CAPABILITY } from '../../app/lib/migration/core-contract'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { createCrewWorkerCommandTestInstance } from '../../server/utils/crew-worker-command-test-instance'
import { createMemoryDb } from '../helpers/memory-db'
import { seedPayrollC1Source } from '../helpers/payroll-c1-source'
import { readQuantityCoreSource } from '../helpers/quantity-migration-source'

it('真实工人日薪经受控网络保 NULL/0/481，旧缺字段不补价且重复迁入保日常更正', async () => {
  const db = await createMemoryDb()
  try {
    const source = await seedPayrollC1Source(db)
    expect(source.entities.workers.map(row => [row.legacyId, row.attributes?.dailyWage])).toEqual([['c1-null', null], ['c1-worker', 481], ['c1-zero', 0]])
    const request = { workspaceId: 'workspace-default', actorId: 'actor-default', requiredCapability: CORE_MIGRATION_CAPABILITY, commandId: 'worker-wage-source', source, backup: null }
    expect(parseCoreMigrationSourceCommand(JSON.parse(JSON.stringify(request))).source).toEqual(source)
    const oldPackage = structuredClone(request)
    delete oldPackage.source.entities.workers[0]!.attributes
    expect(parseCoreMigrationSourceCommand(oldPackage).source.entities.workers[0]!.attributes).toBeUndefined()
    const snapshot: CoreMigrationSnapshotDTO = { authority: 'central', activeBatchId: 'worker-wage-batch', entities: [] }
    for (const entityType of ['crews', 'workers'] as const) {
      for (const row of source.entities[entityType])
        snapshot.entities.push({ ...row, entityType, id: row.legacyId, attributes: row.attributes ?? {}, references: row.references ?? {}, quantity: null, amount: null, deletedAt: null, batchId: 'worker-wage-batch' })
    }
    snapshot.entities.push({ ...snapshot.entities.find(row => row.id === 'c1-null')!, id: 'c1-missing', legacyId: 'c1-missing', name: '旧包未导出日薪', attributes: {} })
    const owner = createCrewWorkerCommandTestInstance({ now: () => '2026-09-14T00:00:00Z' })
    owner.prepareMigrationSnapshot(snapshot)()
    const before = owner.payrollWorkerFacts()
    expect(before.rows.map(row => [row.workerId, row.dailyWage, row.dailyWageState])).toEqual([['c1-null', null, 'null'], ['c1-worker', 481, 'value'], ['c1-zero', 0, 'value'], ['c1-missing', null, 'missing']])
    expect(before.rows.find(row => row.workerId === 'c1-worker')).toMatchObject({ currentProjectId: 'c1-project', crewId: 'c1-crew-current' })
    expect(owner.payrollWorkerFacts('another-session').rows).toEqual([])
    const session = { workspaceId: request.workspaceId, actorId: request.actorId, capabilities: [WORKER_WRITE_CAPABILITY] }
    const form = owner.workerForm('c1-missing', session)
    await owner.executeWorker({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: WORKER_WRITE_CAPABILITY, commandId: 'set-worker-wage', id: 'c1-missing', baseVersion: form.version, action: 'draft', draft: { ...form.draft, dailyWage: 0 }, attachments: {} }, session)
    const changed = owner.payrollWorkerFacts()
    expect(changed.sourceVersion).not.toBe(before.sourceVersion)
    expect(changed.rows.find(row => row.workerId === 'c1-missing')).toMatchObject({ dailyWage: 0, dailyWageState: 'value' })
    owner.prepareMigrationSnapshot(snapshot)()
    expect(owner.payrollWorkerFacts()).toEqual(changed)
    for (const invalid of ['481', -1, Number.POSITIVE_INFINITY]) {
      const altered = structuredClone(request)
      altered.source.entities.workers[0]!.attributes = { dailyWage: invalid }
      expect(() => parseCoreMigrationSourceCommand(altered)).toThrow()
    }
  }
  finally { db.close() }
})

it.each(['not-a-number', -1])('原 SQLite 非法日薪不能在导出时变成 NULL/0：%s', async (invalid) => {
  const db = await createMemoryDb()
  try {
    await seedPayrollC1Source(db)
    await db.execute('UPDATE workers SET daily_wage=? WHERE id=\'c1-worker\'', [invalid])
    await expect(readQuantityCoreSource(db)).rejects.toThrow('日薪')
  }
  finally { db.close() }
})
