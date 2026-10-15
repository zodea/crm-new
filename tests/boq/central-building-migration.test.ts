import { expect, it } from 'vitest'
import { createBoqBuildingFixture } from '../helpers/boq-building-fixture'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { seedWbsMigrationSource } from '../helpers/wbs-migration-source'

it('受控 SQLite 导出保留已确认原始 BOQ 行文件、追踪行与来源资格', async () => {
  const db = await createMigratedMemoryDb()
  try {
    const source = await seedWbsMigrationSource(db)
    const catalog = JSON.parse(String(source.entities.construction_contracts[0]!.attributes!.boqCatalogJson))
    expect(catalog.find((row: { id: string }) => row.id === 'q-boq')).toMatchObject({ source: { boqFileId: 'q-source', changeOrderId: null, traceKey: '清单:1', sourceSheet: '清单', sourceRow: 1, confirmed: true } })
  }
  finally { db.close() }
})

it('中央更正经同批确认和重复来源同步保留，恢复不能删除已有日常更正', async () => {
  const fixture = await createBoqBuildingFixture()
  const { service, owner, core, session, query, batch, envelope } = fixture
  try {
    const before = await service.read(query)
    expect(before.lines.find(row => row.id === 'q-boq')?.sourceKind).toBe('confirmed-import')
    const buildingId = before.buildings.find(row => row.code === 'B2')!.id
    const command = { ...query, workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'owner-document:write' as const, commandId: 'correct-migrated', sourceVersion: before.sourceVersion, lineId: 'q-boq', buildingId, reason: '原清单楼栋识别更正' }
    await service.execute(command)
    const corrected = await service.read(query)
    await core.confirm({ ...envelope('same-batch'), batchId: batch.batchId }, session)
    expect((await service.read(query)).lines).toEqual(corrected.lines)
    owner.synchronizeMigrationSnapshot(core.snapshot(session))
    expect((await service.read(query)).lines).toEqual(corrected.lines)
    expect((await service.read(query)).audit).toEqual(corrected.audit)
    const snapshot = core.snapshot(session)
    const changedSource = structuredClone(snapshot)
    const contract = changedSource.entities.find(row => row.entityType === 'construction_contracts' && row.id === query.contractId)!
    const catalog = JSON.parse(String(contract.attributes.boqCatalogJson))
    catalog.find((row: { id: string }) => row.id === 'q-boq').source.boqFileId = 'replacement-file'
    contract.attributes.boqCatalogJson = JSON.stringify(catalog)
    expect(() => owner.synchronizeMigrationSnapshot(changedSource)).toThrow(/原始来源/)
    expect((await service.read(query)).lines).toEqual(corrected.lines)
    await expect(core.rollback({ ...envelope('rollback-corrected'), batchId: batch.batchId }, session)).rejects.toThrow(/日常更正/)
    expect(core.snapshot(session)).toEqual(snapshot)
    expect((await service.read(query)).audit).toEqual(corrected.audit)
    expect(await service.execute(command)).toMatchObject({ commandId: command.commandId, auditId: corrected.audit[0]!.id })
  }
  finally { await fixture.close() }
})
