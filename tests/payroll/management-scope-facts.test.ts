import { expect, it } from 'vitest'
import { loadPayrollAManagementScopeFacts } from '../../server/utils/payroll-management-scope-facts'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { seedPayrollAQuantitySource } from '../helpers/payroll-a-quantity-source'

const context = { workspaceId: 'w', actorId: 'a', origin: 'real' as const, sourceVersion: 'test', capabilities: ['payroll:read'], readonly: true }
it('原责任范围包含未完成格子，保留明确细格，不产生施工完成数量', async () => {
  const db = await createMigratedMemoryDb()
  try {
    await seedPayrollAQuantitySource(db)
    await db.execute('DELETE FROM unit_stage_completions WHERE assignment_id=\'pa-asg-other\'')
    const result = await loadPayrollAManagementScopeFacts(db, { projectId: 'pa-project' }, context)
    const pending = result.responsibilityOptions.find(row => row.assignmentId === 'pa-asg-other')!
    expect(pending).toMatchObject({ eligible: true, workerId: 'pa-worker-other', scopeIds: [], cells: [{ unitId: 'pa-unit-other', roomId: 'pa-room-other', itemId: 'pa-item' }] })
    expect(result.cellOptions.find(row => row.unitId === 'pa-unit-other')?.locationLabel).toContain('独立房间')
    expect(pending.sources).toEqual([])
    const allowed = await loadPayrollAManagementScopeFacts(db, { projectId: 'pa-project' }, { ...context, capabilities: [...context.capabilities, 'quantity:read', 'worker:list:read'] })
    expect(allowed.responsibilityOptions.find(row => row.assignmentId === 'pa-asg-other')!.sources).toMatchObject([{ subject: { entity: 'quantity-unit', id: 'pa-unit-other' }, filters: { projectId: 'pa-project', dataOrigin: 'real' } }, { subject: { entity: 'worker', id: 'pa-worker-other' } }])
    expect(result.responsibilityOptions.some(row => row.assignmentId === 'pa-asg-old')).toBe(false)
    await db.execute('INSERT INTO operation_logs(id,table_name,record_id,action,after_data,operator) VALUES(?,?,?,?,?,?)', ['scope-create-proof', 'unit_assignment_scopes', 'missing-original-scope', 'create', JSON.stringify({ id: 'missing-original-scope', assignment_id: 'pa-asg-other', room_id: 'pa-room-other', item_id: 'pa-item' }), 'original-operator'])
    const missing = await loadPayrollAManagementScopeFacts(db, { projectId: 'pa-project' }, context)
    expect(missing.responsibilityOptions.find(row => row.assignmentId === 'pa-asg-other')).toMatchObject({ eligible: false, cells: [] })
    await db.execute('INSERT INTO unit_assignment_scopes(id,assignment_id,room_id,item_id,deleted_at) VALUES(\'broken\',\'pa-asg-other\',\'pa-room-eight\',\'pa-item\',\'2026-08-20\')')
    const broken = await loadPayrollAManagementScopeFacts(db, { projectId: 'pa-project' }, context)
    expect(broken.responsibilityOptions.find(row => row.assignmentId === 'pa-asg-other')).toMatchObject({ eligible: false, cells: [] })
    expect(broken.sourceVersion).not.toBe(result.sourceVersion)
    await expect(loadPayrollAManagementScopeFacts(db, { projectId: 'pa-project' }, { ...context, capabilities: [] })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  }
  finally { db.close() }
})
