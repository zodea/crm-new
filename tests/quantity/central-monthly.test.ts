import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { seedIfEmpty } from '~/lib/db/seed'
import { loadQuantityMonthlyBoqFacts } from '~/lib/quantity/central-monthly'
import { productionQuantityVersion } from '../../server/utils/production-quantity-record'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let db: TestDb
beforeEach(async () => {
  db = await createMigratedMemoryDb()
  await seedIfEmpty(db)
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
    const ids = await db.select<{ id: string }>('SELECT id FROM boq_lines WHERE project_id = ?', ['proj_demo_001'])
    const lines = ids.map(row => ({ id: row.id, contractId: 'contract', contractName: '当前合同', contractNo: 'HT', itemName: '清单', unit: '㎡', qty: 100, unitPrice: 2, approvedDeltaQty: 0, effectiveUnitPrice: 2, building: null, updatedAt: null }))
    const load = () => loadQuantityMonthlyBoqFacts(db, 'proj_demo_001', lines, 'current-version')
    const before = await load()
    expect(before.length).toBeGreaterThan(0)
    const first = before[0]!
    await db.execute('UPDATE house_type_template_items SET field_qty = NULL WHERE boq_line_id = ?', [first.boqLineId])
    const missing = (await load()).find(row => row.boqLineId === first.boqLineId && row.periodNo === first.periodNo)!
    expect(missing).toMatchObject({ autoQty: 0, quantityBasis: 'field', sourceVersion: 'current-version' })
    expect(missing.missingQtyCount).toBeGreaterThan(0)
    await db.execute('UPDATE house_type_template_items SET field_qty = 7 WHERE boq_line_id = ?', [first.boqLineId])
    const current = (await load()).find(row => row.boqLineId === first.boqLineId && row.periodNo === first.periodNo)!
    expect(current.autoQty).toBe(7 * missing.missingQtyCount)
    expect(current.missingQtyCount).toBe(0)
    await db.execute('UPDATE house_type_template_items SET contract_qty = 0, provisional_qty = NULL WHERE boq_line_id = ?', [first.boqLineId])
    const contract = (await loadQuantityMonthlyBoqFacts(db, 'proj_demo_001', lines, 'contract-version', 'contract')).find(row => row.boqLineId === first.boqLineId && row.periodNo === first.periodNo)!
    expect(contract).toMatchObject({ autoQty: 0, missingQtyCount: 0, quantityBasis: 'contract' })
    const provisional = (await loadQuantityMonthlyBoqFacts(db, 'proj_demo_001', lines, 'provisional-version', 'provisional')).find(row => row.boqLineId === first.boqLineId && row.periodNo === first.periodNo)!
    expect(provisional).toMatchObject({ autoQty: 0, quantityBasis: 'provisional' })
    expect(provisional.missingQtyCount).toBeGreaterThan(0)
    expect(await loadQuantityMonthlyBoqFacts(db, 'proj_demo_001', [], 'missing-catalog')).toEqual([])
    await db.execute('UPDATE construction_stage_items SET is_reporting_stage = 0')
    await expect(load()).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('报量阶段') } })
    // 只有尚未投入实际户的模板时，不把配置中的模板当成当前取数阻塞。
    await db.execute('UPDATE units SET deleted_at = ?', ['2026-09-11T04:00:00.000Z'])
    expect(await load()).toEqual([])
  })
})
