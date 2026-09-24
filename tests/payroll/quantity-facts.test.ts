import { expect, it } from 'vitest'
import { loadPayrollAQuantityFacts } from '../../server/utils/payroll-quantity-facts'
import { createMemoryDb } from '../helpers/memory-db'
import { seedPayrollAQuantitySource } from '../helpers/payroll-a-quantity-source'

it('完成保留旧个人scope、8/null/0及原责任，缺量只影响原主体不跟随当前转组', async () => {
  const db = await createMemoryDb()
  try {
    await seedPayrollAQuantitySource(db)
    const result = await loadPayrollAQuantityFacts(db, { projectId: 'pa-project', month: '2026-08' })
    const old = result.rows.filter(row => row.assignmentId === 'pa-asg-old')
    expect(old).toHaveLength(3)
    expect(old.map(row => [row.roomId, row.fieldQty]).sort()).toEqual([
      ['pa-room-eight', 8],
      ['pa-room-missing', null],
      ['pa-room-zero', 0],
    ])
    expect(old.every(row => row.workerId === 'pa-worker-old' && row.crewId === null && row.scopeKind === 'selected')).toBe(true)
    expect(old[0]?.scopeRows).toHaveLength(3)
    expect(old[0]?.scopeRows.every(row => row.deletedAt !== null)).toBe(true)
    expect(result.rows.find(row => row.workerId === 'pa-worker-other')?.fieldQty).toBe(4)
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'field-quantity-missing', affects: 'subject', workerId: 'pa-worker-old', crewId: null, assignmentId: 'pa-asg-old', roomId: 'pa-room-missing' })])
  }
  finally { db.close() }
})

it('缺失scope和责任按可证明原审计限定主体，不扩成整户也不转给当前责任', async () => {
  const db = await createMemoryDb()
  try {
    await seedPayrollAQuantitySource(db)
    const [scope] = await db.select('SELECT * FROM unit_assignment_scopes WHERE id=\'pa-scope-eight\'')
    const [assignment] = await db.select('SELECT * FROM unit_assignments WHERE id=\'pa-asg-old\'')
    await db.execute('INSERT INTO operation_logs(id,table_name,record_id,action,after_data) VALUES (\'scope-proof\',\'unit_assignment_scopes\',\'pa-scope-eight\',\'create\',?)', [JSON.stringify(scope)])
    await db.execute('INSERT INTO operation_logs(id,table_name,record_id,action,after_data) VALUES (\'assignment-proof\',\'unit_assignments\',\'pa-asg-old\',\'create\',?)', [JSON.stringify(assignment)])
    await db.execute('DELETE FROM unit_assignment_scopes WHERE assignment_id=\'pa-asg-old\'')
    const missingScope = await loadPayrollAQuantityFacts(db, { projectId: 'pa-project', month: '2026-08' })
    expect(missingScope.rows.filter(row => row.assignmentId === 'pa-asg-old')).toEqual([])
    expect(missingScope.diagnostics).toContainEqual(expect.objectContaining({ code: 'assignment-scope-incomplete', affects: 'subject', workerId: 'pa-worker-old', roomId: 'pa-room-eight' }))
    // 模拟旧库已存在的悬空责任；只在此隔离内存库制造破损，不放松正常写入外键。
    await db.execute('PRAGMA foreign_keys=OFF')
    await db.execute('DELETE FROM unit_assignments WHERE id=\'pa-asg-old\'')
    await db.execute('PRAGMA foreign_keys=ON')
    const missingAssignment = await loadPayrollAQuantityFacts(db, { projectId: 'pa-project', month: '2026-08' })
    expect(missingAssignment.diagnostics).toContainEqual(expect.objectContaining({ code: 'assignment-unproven', affects: 'subject', workerId: 'pa-worker-old' }))
    expect(missingAssignment.rows.map(row => row.workerId)).toEqual(['pa-worker-other'])
  }
  finally { db.close() }
})

it('完成月份按原有效日期累计，错误日期不进入工资来源', async () => {
  const db = await createMemoryDb()
  try {
    await seedPayrollAQuantitySource(db)
    expect((await loadPayrollAQuantityFacts(db, { projectId: 'pa-project', month: '2026-07' })).rows).toEqual([])
    expect((await loadPayrollAQuantityFacts(db, { projectId: 'pa-project', month: '2026-09' })).rows).toHaveLength(4)
    await db.execute('UPDATE unit_stage_completions SET completed_at=\'2026-02-30\' WHERE id=\'pa-done-old\'')
    const result = await loadPayrollAQuantityFacts(db, { projectId: 'pa-project', month: '2026-08' })
    expect(result.rows.map(row => row.workerId)).toEqual(['pa-worker-other'])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'completion-date-invalid', workerId: 'pa-worker-old' }))
  }
  finally { db.close() }
})

it('内容指纹发现同总量同时间的换量，重建完成ID不重建已付责任身份', async () => {
  const db = await createMemoryDb()
  try {
    await seedPayrollAQuantitySource(db)
    const read = () => loadPayrollAQuantityFacts(db, { projectId: 'pa-project', month: '2026-08' })
    const original = await read()
    await db.execute('UPDATE house_type_template_items SET field_qty=CASE id WHEN \'pa-line-eight\' THEN 4 WHEN \'pa-line-other\' THEN 8 END WHERE id IN (\'pa-line-eight\',\'pa-line-other\')')
    const changed = await read()
    expect(changed.sourceVersion).not.toBe(original.sourceVersion)
    expect(changed.rows.find(row => row.templateLineId === 'pa-line-eight')?.sourceFingerprint).not.toBe(original.rows.find(row => row.templateLineId === 'pa-line-eight')?.sourceFingerprint)
    await db.execute('UPDATE unit_stage_completions SET id=\'pa-done-recreated\' WHERE id=\'pa-done-old\'')
    const recreated = await read()
    expect(recreated.rows.filter(row => row.assignmentId === 'pa-asg-old').map(row => row.ownershipKey)).toEqual(original.rows.filter(row => row.assignmentId === 'pa-asg-old').map(row => row.ownershipKey))
    expect(recreated.rows.find(row => row.assignmentId === 'pa-asg-old')?.completionId).toBe('pa-done-recreated')
    expect(recreated.sourceVersion).not.toBe(changed.sourceVersion)
    await db.execute('UPDATE items SET unit=NULL WHERE id=\'pa-item\'')
    const unitMissing = await read()
    expect(unitMissing.rows.every(row => row.unit === null)).toBe(true)
    expect(unitMissing.diagnostics.filter(row => row.code === 'quantity-unit-missing')).toHaveLength(4)
  }
  finally { db.close() }
})
