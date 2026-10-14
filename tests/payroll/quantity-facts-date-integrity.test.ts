import { expect, it } from 'vitest'
import { loadPayrollAQuantityFacts } from '../../server/utils/payroll-quantity-facts'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { seedPayrollAQuantitySource } from '../helpers/payroll-a-quantity-source'

it.each(['2026-13-01', '2026-09-31'])('无效完成日期 %s 不能被当成未来有效事实而静默排除', async (invalidDate) => {
  const db = await createMigratedMemoryDb()
  try {
    await seedPayrollAQuantitySource(db)
    await db.execute('UPDATE unit_stage_completions SET completed_at=? WHERE id=?', [invalidDate, 'pa-done-old'])
    const invalid = await loadPayrollAQuantityFacts(db, { projectId: 'pa-project', month: '2026-08' })
    expect(invalid.rows.map(row => row.workerId)).toEqual(['pa-worker-other'])
    expect(invalid.diagnostics).toContainEqual(expect.objectContaining({
      code: 'completion-date-invalid',
      affects: 'subject',
      workerId: 'pa-worker-old',
      completionId: 'pa-done-old',
    }))

    await db.execute('UPDATE unit_stage_completions SET completed_at=? WHERE id=?', ['2026-09-10', 'pa-done-old'])
    const future = await loadPayrollAQuantityFacts(db, { projectId: 'pa-project', month: '2026-08' })
    expect(future.rows.map(row => row.workerId)).toEqual(['pa-worker-other'])
    expect(future.diagnostics).toEqual([])
  }
  finally {
    db.close()
  }
})
