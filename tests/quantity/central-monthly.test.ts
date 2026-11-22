import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadQuantityMonthlyBoqFacts } from '~/lib/quantity/central-monthly'
import { productionQuantityVersion } from '../../server/utils/production-quantity-record'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let db: TestDb
beforeEach(async () => {
  db = await createMigratedMemoryDb()
  await db.execute('INSERT INTO projects (id, name) VALUES (\'project\', \'测试项目\')')
  await db.execute('INSERT INTO contracts (id, name, kind, project_id) VALUES (\'contract\', \'施工合同\', \'施工\', \'project\')')
  await db.execute('INSERT INTO boq_files (id, contract_id, file_name) VALUES (\'file\', \'contract\', \'清单.xlsx\')')
  await db.execute('INSERT INTO boq_lines (id, boq_file_id, project_id, contract_id, item_name) VALUES (\'boq\', \'file\', \'project\', \'contract\', \'腻子\')')
  await db.execute('INSERT INTO buildings (id, project_id, code, name) VALUES (\'building\', \'project\', \'B\', \'一栋\')')
  await db.execute('INSERT INTO floors (id, building_id, code, name) VALUES (\'floor\', \'building\', \'F\', \'一层\')')
  await db.execute('INSERT INTO house_type_templates (id, project_id, code, name) VALUES (\'template\', \'project\', \'T\', \'户型\')')
  await db.execute('INSERT INTO units (id, floor_id, house_type_template_id, code) VALUES (\'unit-1\', \'floor\', \'template\', \'101\'), (\'unit-2\', \'floor\', \'template\', \'102\')')
  await db.execute('INSERT INTO rooms (id, template_id, code, name) VALUES (\'room\', \'template\', \'R\', \'客厅\')')
  await db.execute('INSERT INTO items (id, project_id, code, name, trade, unit) VALUES (\'item\', \'project\', \'I\', \'腻子\', \'油漆工\', \'㎡\')')
  await db.execute('INSERT INTO house_type_template_items (id, room_id, item_id, boq_line_id, contract_qty, provisional_qty, field_qty) VALUES (\'line\', \'room\', \'item\', \'boq\', 3, 4, 5)')
  await db.execute('INSERT INTO construction_stages (id, project_id, code, name, trade) VALUES (\'stage\', \'project\', \'S\', \'报量阶段\', \'油漆工\')')
  await db.execute('INSERT INTO construction_stage_items (id, stage_id, item_id, is_reporting_stage) VALUES (\'mapping\', \'stage\', \'item\', 1)')
  await db.execute('INSERT INTO crews (id, name, trade) VALUES (\'crew\', \'班组\', \'油漆工\')')
  await db.execute('INSERT INTO unit_assignments (id, unit_id, trade, crew_id) VALUES (\'assignment-1\', \'unit-1\', \'油漆工\', \'crew\'), (\'assignment-2\', \'unit-2\', \'油漆工\', \'crew\')')
  await db.execute('INSERT INTO unit_stage_completions (id, unit_id, stage_id, assignment_id, status, completed_at) VALUES (\'completion-1\', \'unit-1\', \'stage\', \'assignment-1\', \'completed\', \'2026-05-15\'), (\'completion-2\', \'unit-2\', \'stage\', \'assignment-2\', \'completed\', \'2026-05-16\')')
})
afterEach(() => db.close())

describe('当前工程量至甲方月报', () => {
  it('报量消费版本包含所选月份真实完成事实，其他月份修改不覆盖本期依据', async () => {
    const [done] = await db.select<{ id: string, periodNo: string }>(`SELECT done.id,substr(done.completed_at,1,7) AS periodNo
      FROM unit_stage_completions done JOIN units u ON u.id=done.unit_id JOIN floors f ON f.id=u.floor_id
      JOIN buildings b ON b.id=f.building_id WHERE b.project_id=? AND done.status='completed' ORDER BY done.id LIMIT 1`, ['proj_demo_001'])
    expect(done).toBeDefined()
    const query = { projectId: 'proj_demo_001', origin: 'real' as const, includeDemo: false, periodNo: done!.periodNo }
    const before = await productionQuantityVersion(db, query.projectId, query, 'monthly')
    await db.execute('UPDATE unit_stage_completions SET updated_at=? WHERE id=?', ['2026-10-07T09:00:00.000Z', done!.id])
    expect(await productionQuantityVersion(db, query.projectId, query, 'monthly')).toBe(before)
    await db.execute('UPDATE unit_stage_completions SET status=\'draft\' WHERE id=?', [done!.id])
    const changed = await productionQuantityVersion(db, query.projectId, query, 'monthly')
    expect(changed).not.toBe(before)
    await db.execute('UPDATE unit_stage_completions SET status=\'draft\',updated_at=? WHERE substr(completed_at,1,7)<>?', ['2026-10-07T10:00:00.000Z', done!.periodNo])
    expect(await productionQuantityVersion(db, query.projectId, query, 'monthly')).toBe(changed)
    await db.execute('UPDATE construction_stages SET name=? WHERE id NOT IN(SELECT stage_id FROM construction_stage_items WHERE is_reporting_stage=1)', ['未采用阶段新名称'])
    expect(await productionQuantityVersion(db, query.projectId, query, 'monthly')).toBe(changed)
  })
  it('指定新月份仅对实际已配置报量范围返回真实零，未配置仍拒绝且不借其他月量', async () => {
    const ids = await db.select<{ id: string }>('SELECT id FROM boq_lines WHERE project_id = ?', ['proj_demo_001'])
    const lines = ids.map(row => ({ id: row.id, contractId: 'contract', contractName: '当前合同', contractNo: 'HT', itemName: '清单', unit: '㎡', qty: 100, unitPrice: 2, approvedDeltaQty: 0, effectiveUnitPrice: 2, building: null, updatedAt: null }))
    const facts = await loadQuantityMonthlyBoqFacts(db, 'proj_demo_001', lines, 'new-month-version', 'field', '2099-12')
    expect(facts.length).toBeGreaterThan(0)
    expect(facts.every(row => row.periodNo === '2099-12' && row.autoQty === 0 && row.missingQtyCount === 0)).toBe(true)
    await db.execute('UPDATE construction_stage_items SET is_reporting_stage = 0')
    await expect(loadQuantityMonthlyBoqFacts(db, 'proj_demo_001', lines, 'missing-mapping', 'field', '2099-12')).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await db.execute('UPDATE units SET deleted_at = ?', ['2026-10-07T04:00:00.000Z'])
    expect(await loadQuantityMonthlyBoqFacts(db, 'proj_demo_001', lines, 'unused-templates', 'field', '2099-12')).toEqual([])
  })
  it('已完成且明确报量的阶段才计量，模板现场量实时生效并保留缺量计数', async () => {
    const lines = [{ id: 'boq', contractId: 'contract', contractName: '当前合同', contractNo: 'HT', itemName: '清单', unit: '㎡', qty: 100, unitPrice: 2, approvedDeltaQty: 0, effectiveUnitPrice: 2, building: null, updatedAt: null }]
    const load = () => loadQuantityMonthlyBoqFacts(db, 'project', lines, 'current-version')
    const before = await load()
    expect(before).toHaveLength(1)
    const first = before[0]!
    expect(first).toMatchObject({ boqLineId: 'boq', periodNo: '2026-05', autoQty: 10, missingQtyCount: 0 })
    await db.execute('UPDATE house_type_template_items SET field_qty = NULL WHERE boq_line_id = ?', [first.boqLineId])
    const missing = (await load()).find(row => row.boqLineId === first.boqLineId && row.periodNo === first.periodNo)!
    expect(missing).toMatchObject({ autoQty: 0, quantityBasis: 'field', sourceVersion: 'current-version' })
    expect(missing.missingQtyCount).toBe(2)
    await db.execute('UPDATE house_type_template_items SET field_qty = 7 WHERE boq_line_id = ?', [first.boqLineId])
    const current = (await load()).find(row => row.boqLineId === first.boqLineId && row.periodNo === first.periodNo)!
    expect(current.autoQty).toBe(14)
    expect(current.missingQtyCount).toBe(0)
    await db.execute('UPDATE house_type_template_items SET contract_qty = 0, provisional_qty = NULL WHERE boq_line_id = ?', [first.boqLineId])
    const contract = (await loadQuantityMonthlyBoqFacts(db, 'project', lines, 'contract-version', 'contract')).find(row => row.boqLineId === first.boqLineId && row.periodNo === first.periodNo)!
    expect(contract).toMatchObject({ autoQty: 0, missingQtyCount: 0, quantityBasis: 'contract' })
    const provisional = (await loadQuantityMonthlyBoqFacts(db, 'project', lines, 'provisional-version', 'provisional')).find(row => row.boqLineId === first.boqLineId && row.periodNo === first.periodNo)!
    expect(provisional).toMatchObject({ autoQty: 0, quantityBasis: 'provisional' })
    expect(provisional.missingQtyCount).toBe(2)
    expect(await loadQuantityMonthlyBoqFacts(db, 'project', [], 'missing-catalog')).toEqual([])
    await db.execute('UPDATE construction_stage_items SET is_reporting_stage = 0')
    await expect(load()).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('报量阶段') } })
    // 只有尚未投入实际户的模板时，不把配置中的模板当成当前取数阻塞。
    await db.execute('UPDATE units SET deleted_at = ?', ['2026-09-11T04:00:00.000Z'])
    expect(await load()).toEqual([])
  })
})
