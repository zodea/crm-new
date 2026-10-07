import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import { expect, it } from 'vitest'
import { CREW_WRITE_CAPABILITY } from '../../app/lib/crew-worker/command-contract'
import { CREW_PAYROLL_FEE_FIELDS } from '../../app/lib/crew-worker/payroll-fee-defaults'
import { CORE_MIGRATION_CAPABILITY } from '../../app/lib/migration/core-contract'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { createCrewWorkerCommandTestInstance } from '../../server/utils/crew-worker-command-test-instance'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { seedPayrollAQuantitySource } from '../helpers/payroll-a-quantity-source'
import { readQuantityCoreSource } from '../helpers/quantity-migration-source'

it('班组费用默认经真实导出与owner保留0/false/null/缺字段，改名不采用表单默认', async () => {
  const db = await createMigratedMemoryDb()
  try {
    await seedPayrollAQuantitySource(db)
    await db.execute('UPDATE crews SET rent_subsidy_enabled=0,rent_subsidy_price=0,mgmt_fee_enabled=1,mgmt_fee_price=NULL WHERE id=\'pa-crew-current\'')
    const source = await readQuantityCoreSource(db)
    expect(source.entities.crews[0]!.attributes).toMatchObject({ rentSubsidyEnabled: 0, rentSubsidyPrice: 0, mgmtFeeEnabled: 1, mgmtFeePrice: null })
    const request = { workspaceId: 'workspace-default', actorId: 'actor-default', requiredCapability: CORE_MIGRATION_CAPABILITY, commandId: 'crew-fees-source', source, backup: null }
    expect(parseCoreMigrationSourceCommand(JSON.parse(JSON.stringify(request))).source).toEqual(source)
    const snapshot: CoreMigrationSnapshotDTO = { authority: 'central', activeBatchId: 'crew-fees-batch', entities: source.entities.crews.map(row => ({ ...row, entityType: 'crews', id: row.legacyId, attributes: row.attributes ?? {}, references: {}, quantity: null, amount: null, deletedAt: null, batchId: 'crew-fees-batch' })) }
    snapshot.entities.push({ ...snapshot.entities[0]!, id: 'old-missing', legacyId: 'old-missing', name: '费用未知的旧班组', attributes: {} })
    snapshot.entities.push({ ...snapshot.entities[0]!, id: 'old-null', legacyId: 'old-null', name: '明确空的旧班组', attributes: { rentSubsidyEnabled: null, rentSubsidyPrice: null, mgmtFeeEnabled: null, mgmtFeePrice: null } })
    const owner = createCrewWorkerCommandTestInstance()
    owner.prepareMigrationSnapshot(snapshot)()
    const facts = () => owner.payrollCrewFeeDefaults().rows
    expect(facts().find(f => f.crewId === 'pa-crew-current')).toMatchObject({ rentEnabled: { state: 'value', value: false }, rentUnitPrice: { state: 'value', value: 0 }, managementEnabled: { state: 'value', value: true }, managementUnitPrice: { state: 'null', value: null } })
    expect(facts().find(f => f.crewId === 'old-null')).toMatchObject({ rentEnabled: { state: 'null', value: null }, managementEnabled: { state: 'null', value: null } })
    const unknown = facts().find(f => f.crewId === 'old-missing')!
    expect(unknown).toMatchObject({ rentEnabled: { state: 'missing' }, rentUnitPrice: { state: 'missing' }, managementEnabled: { state: 'missing' }, managementUnitPrice: { state: 'missing' } })
    const session = { workspaceId: request.workspaceId, actorId: request.actorId, capabilities: [CREW_WRITE_CAPABILITY] }
    const form = owner.crewForm('old-missing', session)
    await owner.executeCrew({ ...session, requiredCapability: CREW_WRITE_CAPABILITY, commandId: 'rename-only', id: 'old-missing', baseVersion: form.version, action: 'draft', draft: { ...form.draft, name: '仅改名仍未知' }, attachments: {} }, session)
    expect(facts().find(f => f.crewId === 'old-missing')).toEqual(unknown)
    const edited = owner.crewForm('old-missing', session)
    await owner.executeCrew({ ...session, requiredCapability: CREW_WRITE_CAPABILITY, commandId: 'adopt-zero', id: 'old-missing', baseVersion: edited.version, action: 'draft', draft: { ...edited.draft, rentSubsidyEnabled: true, rentSubsidyPrice: 0 }, attachments: {} }, session)
    const adopted = facts().find(f => f.crewId === 'old-missing')!
    expect(adopted).toMatchObject({ rentEnabled: { state: 'value', value: true }, rentUnitPrice: { state: 'value', value: 0 }, managementEnabled: { state: 'missing' } })
    expect(adopted.sourceVersion).not.toBe(unknown.sourceVersion)
    owner.prepareMigrationSnapshot(snapshot)()
    expect(facts().find(f => f.crewId === 'old-missing')).toEqual(adopted)
    expect(owner.payrollCrewFeeDefaults('other').rows).toEqual([])
  }
  finally { db.close() }
})

it.each(Array.from([['rentSubsidyEnabled', 2], ['mgmtFeeEnabled', false], ['rentSubsidyPrice', -1], ['mgmtFeePrice', '0']] as const).map(input1 => ({ input1 })))('真实旧库没有费用列时导出不补空，来源非法开关/负价/字符串被拒绝：输入案例 %#', async ({ input1: [field, invalid] }) => {
  const db = await createMigratedMemoryDb()
  try {
    await seedPayrollAQuantitySource(db)
    const source = await readQuantityCoreSource(db)
    const envelope = { workspaceId: 'w', actorId: 'a', requiredCapability: CORE_MIGRATION_CAPABILITY, commandId: 'bad-fees', backup: null }

    const bad = structuredClone(source)
    bad.entities.crews[0]!.attributes = { ...bad.entities.crews[0]!.attributes, [field]: invalid } as typeof bad.entities.crews[number]['attributes']
    expect(() => parseCoreMigrationSourceCommand({ ...envelope, source: bad })).toThrow()
    await db.execute('PRAGMA ignore_check_constraints=ON')
    await db.execute('UPDATE crews SET rent_subsidy_price=-1 WHERE id=\'pa-crew-current\'')
    await expect(readQuantityCoreSource(db)).rejects.toMatchObject({ code: 'unidentifiable-source-row' })
    for (const field of CREW_PAYROLL_FEE_FIELDS) await db.execute(`ALTER TABLE crews DROP COLUMN ${field.column}`)
    const old = await readQuantityCoreSource(db)
    for (const row of old.entities.crews) {
      for (const field of CREW_PAYROLL_FEE_FIELDS) expect(Object.hasOwn(row.attributes!, field.attribute)).toBe(false)
    }
  }
  finally { db.close() }
})
