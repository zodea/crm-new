import { expect, it } from 'vitest'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { createCoreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { createQuantityDatabase } from '../../server/utils/quantity-database'
import { applyQuantityMigration, planQuantityMigration } from '../../server/utils/quantity-migration'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { seedQuantityMigrationSource } from '../helpers/quantity-migration-source'

it('工程量候选SQL完全准备后才交换，失败候选不改变现有数据库', async () => {
  const database = await createQuantityDatabase()
  try {
    await database.execute('INSERT INTO projects (id,name) VALUES (\'p\',\'中央项目\')')
    const prepared = await database.prepare(async (candidate) => {
      await candidate.execute('INSERT INTO buildings (id,project_id,code,name) VALUES (\'b\',\'p\',\'B1\',\'一栋\')')
    })
    expect(await database.select('SELECT id FROM buildings')).toEqual([])
    prepared.commit()
    expect(await database.select('SELECT id FROM buildings')).toEqual([{ id: 'b' }])
    await expect(database.prepare(async (candidate) => {
      await candidate.execute('UPDATE buildings SET name=\'未完成的写入\'')
      await candidate.execute('INSERT INTO floors (id,building_id,code,name) VALUES (\'f\',\'missing\',\'F1\',\'孤儿楼层\')')
    })).rejects.toThrow('FOREIGN KEY constraint failed')
    expect(await database.select('SELECT name FROM buildings')).toEqual([{ name: '一栋' }])
    expect(await database.select('SELECT id FROM floors')).toEqual([])
  }
  finally { await database.close() }
})

it('实际SQL导入保留软删、历史BOQ与审计双快照，完成后恢复新增整户触发器', async () => {
  const native = await createMigratedMemoryDb()
  const database = await createQuantityDatabase()
  try {
    const source = await seedQuantityMigrationSource(native)
    const session = resolveBusinessSession()
    const core = createCoreMigrationTestInstance({ createServerId: ({ entityType, legacyId }) => `${entityType}:${legacyId}` })
    const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'core:migration:write' as const, commandId })
    await core.preflight({ ...envelope('preflight'), source, backup: null }, session)
    const hash = 'e'.repeat(64)
    const batch = await core.dryRun({ ...envelope('dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${hash}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: hash, byteLength: 442, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } }, session)
    await core.importBatch({ ...envelope('import'), batchId: batch.batchId }, session)
    await core.confirm({ ...envelope('confirm'), batchId: batch.batchId }, session)
    const plan = planQuantityMigration(core.snapshot(session), new Map())
    ;(await database.prepare(candidate => applyQuantityMigration(candidate, plan))).commit()
    expect(await database.select('SELECT deleted_at FROM buildings WHERE code = \'B0\'')).toEqual([{ deleted_at: '2026-09-10T01:00:00.000Z' }])
    expect(await database.select('SELECT * FROM quantity_boq_references')).toEqual([{ id: 'q-boq', project_id: 'projects:q-project', contract_id: 'construction_contracts:q-contract' }])
    expect(await database.select('SELECT id FROM boq_files')).toEqual([])
    expect(await database.select('SELECT id FROM boq_lines')).toEqual([])
    const [log] = await database.select<{ record_id: string, before_data: string, after_data: string, operator: string }>('SELECT record_id,before_data,after_data,operator FROM operation_logs')
    const mapped = plan.incoming[0]!.graph.tables.unit_stage_completions[0]!
    expect(log!.record_id).toBe(mapped.id)
    expect(JSON.parse(log!.before_data)).toEqual({ ...mapped, note: '更早备注' })
    expect(JSON.parse(log!.after_data)).toEqual(mapped)
    expect(log!.operator).toBe('历史经办人')
    await database.execute('INSERT INTO house_type_templates (id,project_id,code,name) VALUES (\'new-template\',\'projects:q-project\',\'NEW\',\'新户型\')')
    expect(await database.select('SELECT kind FROM rooms WHERE template_id = \'new-template\'')).toEqual([{ kind: 'whole_unit' }])
  }
  finally {
    native.close()
    await database.close()
  }
})

it('中央模板外键只引用真实外部BOQ身份索引，无需制造BOQ文件或量价记录', async () => {
  const database = await createQuantityDatabase()
  try {
    await database.execute('INSERT INTO projects (id,name) VALUES (\'p\',\'中央项目\')')
    await database.execute('INSERT INTO house_type_templates (id,project_id,code,name) VALUES (\'t\',\'p\',\'T\',\'户型\')')
    await database.execute('INSERT INTO rooms (id,template_id,code,name) VALUES (\'r\',\'t\',\'R\',\'客厅\')')
    await database.execute('INSERT INTO items (id,project_id,code,name,trade) VALUES (\'i\',\'p\',\'I\',\'腻子\',\'油漆工\')')
    await database.execute('INSERT INTO quantity_boq_references (id,project_id,contract_id) VALUES (\'real-boq\',\'p\',\'real-contract\')')
    await database.execute('INSERT INTO house_type_template_items (id,room_id,item_id,boq_line_id) VALUES (\'line\',\'r\',\'i\',\'real-boq\')')
    expect(await database.select('SELECT id FROM boq_files')).toEqual([])
    expect(await database.select('SELECT id FROM boq_lines')).toEqual([])
    await expect(database.execute('UPDATE house_type_template_items SET boq_line_id=\'missing\'')).rejects.toThrow('FOREIGN KEY constraint failed')
    expect(await database.select('SELECT boq_line_id FROM house_type_template_items')).toEqual([{ boq_line_id: 'real-boq' }])
  }
  finally { await database.close() }
})
