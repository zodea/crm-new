import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { seedIfEmpty } from '~/lib/db/seed'
import { loadQuantityMonthlyBoqFacts } from '~/lib/quantity/central-monthly'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb
beforeEach(async () => {
  db = await createMemoryDb()
  await runMigrations(db)
  await seedIfEmpty(db)
})
afterEach(() => db.close())

describe('当前工程量至甲方月报', () => {
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
