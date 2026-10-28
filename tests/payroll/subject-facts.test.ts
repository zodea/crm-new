import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CREW_WRITE_CAPABILITY } from '../../app/lib/crew-worker/command-contract'
import { CORE_MIGRATION_CAPABILITY } from '../../app/lib/migration/core-contract'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { createCrewWorkerCommandTestInstance } from '../../server/utils/crew-worker-command-test-instance'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { seedPayrollAQuantitySource } from '../helpers/payroll-a-quantity-source'
import { readQuantityCoreSource } from '../helpers/quantity-migration-source'

describe('班组默认发放比例经迁入来源保真', () => {
  let db: Awaited<ReturnType<typeof createMigratedMemoryDb>>
  let source: Awaited<ReturnType<typeof readQuantityCoreSource>>
  let request: { workspaceId: string, actorId: string, requiredCapability: string, commandId: string, source: typeof source, backup: null }
  beforeAll(async () => {
    db = await createMigratedMemoryDb()
    await seedPayrollAQuantitySource(db)
    source = await readQuantityCoreSource(db)
    request = { workspaceId: 'workspace-default', actorId: 'actor-default', requiredCapability: CORE_MIGRATION_CAPABILITY, commandId: 'ratio-source', source, backup: null }
  })
  afterAll(() => db.close())

  it('真实 SQLite 的原比例经网络来源保留 0 与 0.8，旧缺字段不变成表单默认 0.95', async () => {
    expect(source.entities.crews.map(row => [row.legacyId, row.attributes?.defaultPayRatio])).toEqual([
      ['pa-crew-current', 0],
      ['pa-crew-old', 0.8],
    ])
    const parsed = parseCoreMigrationSourceCommand(JSON.parse(JSON.stringify(request)))
    expect(parsed.source).toEqual(source)
    const snapshot: CoreMigrationSnapshotDTO = {
      authority: 'central',
      activeBatchId: 'ratio-batch',
      entities: source.entities.crews.map(row => ({ ...row, entityType: 'crews', id: row.legacyId, attributes: row.attributes ?? {}, references: {}, quantity: null, amount: null, deletedAt: null, batchId: 'ratio-batch' })),
    }
    snapshot.entities.push({ ...snapshot.entities[0]!, id: 'old-unknown', legacyId: 'old-unknown', name: '旧资料未导出比例', attributes: {} })
    snapshot.entities.push({ ...snapshot.entities[0]!, id: 'old-null', legacyId: 'old-null', name: '原比例缺失', attributes: { defaultPayRatio: null } })
    const owner = createCrewWorkerCommandTestInstance()
    owner.prepareMigrationSnapshot(snapshot)()
    const before = owner.payrollRatioFacts()
    expect(before.rows.map(row => [row.crewId, row.value, row.explicitlyConfigured])).toEqual([
      ['pa-crew-current', 0, true],
      ['pa-crew-old', 0.8, true],
      ['old-unknown', null, false],
      ['old-null', null, false],
    ])
    owner.prepareMigrationSnapshot(snapshot)()
    expect(owner.payrollRatioFacts()).toEqual(before)
    expect(owner.payrollRatioFacts('another-workspace').rows).toEqual([])
    const session = { workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: [CREW_WRITE_CAPABILITY] }
    const form = owner.crewForm('old-unknown', session)
    expect(form.draft.defaultPayRatio).toBeNull()
    await owner.executeCrew({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CREW_WRITE_CAPABILITY, commandId: 'record-ratio', id: 'old-unknown', baseVersion: form.version, action: 'draft', draft: { ...form.draft, defaultPayRatio: 0 }, attachments: {} }, session)
    const changed = owner.payrollRatioFacts()
    expect(changed.sourceVersion).not.toBe(before.sourceVersion)
    expect(changed.rows.find(row => row.crewId === 'old-unknown')).toMatchObject({ value: 0, explicitlyConfigured: true })
    owner.prepareMigrationSnapshot(snapshot)()
    expect(owner.payrollRatioFacts()).toEqual(changed)
  })

  it.each(['0.8', -0.1, 1.1])('来源比例 %s 不是 0 至 1 的数值时拒绝整批来源', (invalid) => {
    const altered = structuredClone(request)
    altered.source.entities.crews[0]!.attributes = { defaultPayRatio: invalid }
    expect(() => parseCoreMigrationSourceCommand(altered)).toThrow('crews[0].attributes.defaultPayRatio必须是 0 至 1 的比例或 null')
  })
})
