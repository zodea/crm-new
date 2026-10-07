import { afterEach, expect, it } from 'vitest'
import { initializePayrollSchema } from '../../app/lib/payroll/central-schema'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { loadPayrollC2ConfigFacts, loadPayrollDayworkFacts, loadPayrollDayworkRecord } from '../../server/utils/payroll-daywork-facts'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { importPayrollC2MigrationSource, seedPayrollC2MigrationSource } from '../helpers/payroll-c2-migration-source'

afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(resolveBusinessSession().workspaceId)
})

it('逐签工事实保留原组、状态、相邻半工与同更新时间的原文变化', async () => {
  const db = await createMigratedMemoryDb()
  try {
    const { dayworkIds } = await seedPayrollC2MigrationSource(db)
    await initializePayrollSchema(db)
    await db.execute('UPDATE workers SET crew_id=? WHERE id=?', ['c2-current', 'c2-worker'])
    const query = { projectId: 'c2-project', month: '2026-08' }
    const first = await loadPayrollDayworkFacts(db, query)
    expect(first.diagnostics).toEqual([])
    expect(first.rows).toHaveLength(2)
    expect(first.rows.find(row => row.id === dayworkIds[0])).toMatchObject({ crewId: 'c2-crew', status: 'confirmed', laborUnits: 0.5, confirmedOn: '2026-08-05', original: { work_content: '原始半工内容', note: '原备注' } })
    expect(first.rows.find(row => row.id === dayworkIds[1])).toMatchObject({ status: 'draft', laborUnits: 0.5, witness: '' })
    await db.execute('UPDATE signed_daywork_records SET note=? WHERE id=?', ['同量同日期新备注', dayworkIds[0]])
    const changed = await loadPayrollDayworkFacts(db, query)
    expect(changed.sourceVersion).not.toBe(first.sourceVersion)
    expect(changed.rows.find(row => row.id === dayworkIds[0])!.sourceFingerprint).not.toBe(first.rows.find(row => row.id === dayworkIds[0])!.sourceFingerprint)
  }
  finally { db.close() }
})

it('公开迁入的隔离原组保完整证据及映射，不能补造可写签工ID', async () => {
  const db = await createMigratedMemoryDb()
  try {
    const { dayworkIds } = await seedPayrollC2MigrationSource(db)
    await db.execute('PRAGMA foreign_keys=OFF')
    await db.execute('UPDATE signed_daywork_records SET crew_id=? WHERE id=?', ['missing-crew', dayworkIds[0]])
    const imported = await importPayrollC2MigrationSource(db)
    const facts = await quantityTestInstance.withWorkspaceTransaction(tx => loadPayrollDayworkFacts(tx, { projectId: imported.projectId, month: '2026-08' }))
    expect(facts.rows).toHaveLength(1)
    expect(facts.diagnostics).toContainEqual(expect.objectContaining({ code: 'daywork-isolated', recordId: null, legacyRecordId: dayworkIds[0], workerId: imported.workerId }))
    expect(facts.evidence[0]!.source.daywork).toContainEqual(expect.objectContaining({ id: dayworkIds[0], crew_id: 'missing-crew', labor_units: 0.5 }))
    expect(facts.evidence[0]!.mappings).toContainEqual(expect.objectContaining({ tableName: 'signed_daywork_records', legacyId: dayworkIds[0], centralId: null }))
  }
  finally { db.close() }
})

it('坏原值不转成可用数值，未知原列/零/NULL保留；空月拒绝，坏日期不因月筛选消失', async () => {
  const db = await createMigratedMemoryDb()
  try {
    const { dayworkIds, configId } = await seedPayrollC2MigrationSource(db)
    await initializePayrollSchema(db)
    await db.execute('PRAGMA ignore_check_constraints=ON')
    // 旧资料允许出现中央新写入不会生成的 NULL；读取接缝必须保留它们。
    await db.execute('PRAGMA foreign_keys=OFF')
    for (const table of ['signed_daywork_records', 'payroll_subject_configs']) {
      await db.execute(`CREATE TABLE raw_fixture AS SELECT * FROM ${table}`)
      await db.execute(`DROP TABLE ${table}`)
      await db.execute(`ALTER TABLE raw_fixture RENAME TO ${table}`)
    }
    await db.execute('ALTER TABLE signed_daywork_records ADD COLUMN original_extra TEXT')
    await db.execute('UPDATE signed_daywork_records SET labor_units=0,work_date=?,original_extra=?,witness=NULL,deleted_at=? WHERE id=?', ['2026-13-02', '未识别原列', '2026-09-01', dayworkIds[0]])
    await db.execute('UPDATE signed_daywork_records SET labor_units=?,start_time=NULL WHERE id=?', ['unknown-number', dayworkIds[1]])
    const query = { projectId: 'c2-project', month: '2026-08' }
    const facts = await loadPayrollDayworkFacts(db, query)
    expect(facts.rows.find(row => row.id === dayworkIds[0])).toMatchObject({ laborUnits: 0, witness: null, deletedAt: '2026-09-01', original: { labor_units: 0, witness: null, original_extra: '未识别原列' } })
    expect(facts.rows.find(row => row.id === dayworkIds[1])).toMatchObject({ laborUnits: null, startTime: null, original: { labor_units: 'unknown-number' } })
    expect(facts.diagnostics).toContainEqual(expect.objectContaining({ code: 'daywork-date-invalid', recordId: dayworkIds[0] }))
    expect(facts.diagnostics).toContainEqual(expect.objectContaining({ code: 'daywork-units-invalid', recordId: dayworkIds[1] }))
    expect((await loadPayrollDayworkRecord(db, dayworkIds[0]!)).record).toEqual(facts.rows.find(row => row.id === dayworkIds[0]))
    await expect(loadPayrollDayworkFacts(db, { ...query, month: '' })).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await db.execute('UPDATE payroll_subject_configs SET unit_rate=0,rule_text=NULL,enabled=0 WHERE id=?', [configId])
    const config = await loadPayrollC2ConfigFacts(db, { projectId: query.projectId, leaderWorkerId: 'c2-leader' })
    expect(config.rows).toEqual([expect.objectContaining({ id: configId, unitRate: 0, ruleText: null, enabled: false, original: expect.objectContaining({ unit_rate: 0, rule_text: null }) })])
    expect(config.diagnostics).toContainEqual(expect.objectContaining({ code: 'c2-rate-invalid', recordId: configId }))
  }
  finally { db.close() }
})
