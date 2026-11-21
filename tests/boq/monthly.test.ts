import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  adjustMonthlyStatementLine,
  generateMonthlyStatement,
  loadMonthlyQuantities,
  loadMonthlyStatement,
  regenerateMonthlyStatement,
} from '~/lib/boq/monthly'
import { seedIfEmpty } from '~/lib/db/seed'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let db: TestDb

beforeEach(async () => {
  db = await createMigratedMemoryDb()
  await seedIfEmpty(db)
})

afterEach(() => db.close())

describe('boq monthly statements', () => {
  it('generates current quantity × effective contract price from completed reporting stages', async () => {
    const generated = await generateMonthlyStatement(
      db,
      'proj_demo_001',
      'con_demo_sg01',
      '2026-04',
    )
    expect(generated.lineCount).toBe(1)
    expect(generated.totalAmount).toBe(1512)

    const statement = await loadMonthlyStatement(db, generated.statementId)
    expect(statement).toMatchObject({
      projectId: 'proj_demo_001',
      contractId: 'con_demo_sg01',
      month: '2026-04',
      status: 'draft',
      totalAmount: 1512,
    })
    expect(statement?.lines).toEqual([
      expect.objectContaining({
        boqLineId: 'boq_line_demo_a_pipe',
        autoQty: 42,
        adjustedQty: null,
        effectiveQty: 42,
        unitPrice: 36,
        amount: 1512,
      }),
    ])
    await expect(generateMonthlyStatement(
      db,
      'proj_demo_001',
      'con_demo_sg01',
      '2026-04',
    )).rejects.toThrow('已存在')
  })

  it('每个基准只读自己的口径，不跨口径静默代用', async () => {
    // 让三量互不相同，确保断言能区分基准，而不是碰巧读到同值。
    await db.execute(
      `UPDATE house_type_template_items SET contract_qty = 40 WHERE id = 'qty_hti_a_pipe'`,
    )

    expect(await loadMonthlyQuantities(
      db,
      'proj_demo_001',
      'con_demo_sg01',
      '2026-04',
      'contract',
    )).toEqual([expect.objectContaining({
      boq_line_id: 'boq_line_demo_a_pipe',
      auto_qty: 40,
      missing_count: 0,
    })])

    expect(await loadMonthlyQuantities(
      db,
      'proj_demo_001',
      'con_demo_sg01',
      '2026-04',
      'provisional',
    )).toEqual([expect.objectContaining({
      boq_line_id: 'boq_line_demo_a_pipe',
      auto_qty: 44,
      missing_count: 0,
    })])

    expect(await loadMonthlyQuantities(
      db,
      'proj_demo_001',
      'con_demo_sg01',
      '2026-04',
      'field',
    )).toEqual([expect.objectContaining({
      boq_line_id: 'boq_line_demo_a_pipe',
      auto_qty: 42,
      missing_count: 0,
    })])
  })

  it('所选基准缺量时显式暴露，不回退到其他口径也不按 0 计入', async () => {
    await db.execute(
      `UPDATE house_type_template_items SET field_qty = NULL WHERE id = 'qty_hti_a_pipe'`,
    )

    // 现场量缺失必须报缺，不能悄悄用暂估量 44 或合同量 42 顶替。
    expect(await loadMonthlyQuantities(
      db,
      'proj_demo_001',
      'con_demo_sg01',
      '2026-04',
      'field',
    )).toEqual([expect.objectContaining({
      boq_line_id: 'boq_line_demo_a_pipe',
      auto_qty: 0,
      missing_count: 1,
    })])

    await expect(generateMonthlyStatement(
      db,
      'proj_demo_001',
      'con_demo_sg01',
      '2026-04',
      'field',
    )).rejects.toThrow('现场复核量缺失')
  })

  it('基准切换真实改变已生成报量单的金额并落库基准', async () => {
    const generated = await generateMonthlyStatement(
      db,
      'proj_demo_001',
      'con_demo_sg01',
      '2026-04',
      'provisional',
    )
    // 暂估量 44 × 合同单价 36，而不是现场量 42 的 1512。
    expect(generated.totalAmount).toBe(1584)

    const statement = await loadMonthlyStatement(db, generated.statementId)
    expect(statement).toMatchObject({
      quantityBasis: 'provisional',
      totalAmount: 1584,
    })
    expect(statement?.lines[0]).toMatchObject({ autoQty: 44, amount: 1584 })
  })

  it('草稿可换基准重算，提交后冻结不再允许改基准', async () => {
    const generated = await generateMonthlyStatement(
      db,
      'proj_demo_001',
      'con_demo_sg01',
      '2026-04',
      'field',
    )
    expect(generated.totalAmount).toBe(1512)

    // 草稿阶段：基准仍可改，金额随之重算。
    await regenerateMonthlyStatement(db, generated.statementId, 'provisional')
    const redone = await loadMonthlyStatement(db, generated.statementId)
    expect(redone).toMatchObject({ quantityBasis: 'provisional', totalAmount: 1584 })
    expect(redone?.lines[0]).toMatchObject({ autoQty: 44, amount: 1584 })

    // 已申报后基准冻结。
    await db.execute(
      `UPDATE monthly_statements SET status = 'adjusted' WHERE id = ?`,
      [generated.statementId],
    )
    await expect(regenerateMonthlyStatement(
      db,
      generated.statementId,
      'field',
    )).rejects.toThrow('只有草稿')
  })

  it('换基准时缺量同样阻断，不会把草稿改成金额偏低的单据', async () => {
    const generated = await generateMonthlyStatement(
      db,
      'proj_demo_001',
      'con_demo_sg01',
      '2026-04',
      'provisional',
    )
    await db.execute(
      `UPDATE house_type_template_items SET field_qty = NULL WHERE id = 'qty_hti_a_pipe'`,
    )
    await expect(regenerateMonthlyStatement(
      db,
      generated.statementId,
      'field',
    )).rejects.toThrow('现场复核量缺失')

    // 阻断后原草稿保持原基准与金额，不被改坏。
    const kept = await loadMonthlyStatement(db, generated.statementId)
    expect(kept).toMatchObject({ quantityBasis: 'provisional', totalAmount: 1584 })
  })

  it('生成时保存来源版本与时间，源数据变化后重算版本随之改变', async () => {
    const generated = await generateMonthlyStatement(
      db,
      'proj_demo_001',
      'con_demo_sg01',
      '2026-04',
      'field',
    )
    const first = await loadMonthlyStatement(db, generated.statementId)
    expect(first?.sourceVersion).toMatch(/^boq-qty-/)
    expect(first?.sourceUpdatedAt).toBeTruthy()
    // 尚未申报，提交时间与操作者留空，不能拿生成时间冒充申报证据。
    expect(first?.submittedAt).toBeNull()
    expect(first?.operatorName).toBe('')

    // 源数据版本要覆盖三量与完成事实两侧，因此这里同时推进两个 updated_at。
    await db.execute(
      `UPDATE house_type_template_items
       SET field_qty = 50, updated_at = '2027-05-01 10:00:00'
       WHERE id = 'qty_hti_a_pipe'`,
    )
    await regenerateMonthlyStatement(db, generated.statementId, 'field')
    const second = await loadMonthlyStatement(db, generated.statementId)
    expect(second?.sourceVersion).not.toBe(first?.sourceVersion)
    expect(second?.sourceUpdatedAt).toBe('2027-05-01 10:00:00')
    expect(second?.totalAmount).toBe(1800)
  })

  it('records manual adjustment trace without advancing the owner report lifecycle', async () => {
    const generated = await generateMonthlyStatement(
      db,
      'proj_demo_001',
      'con_demo_sg01',
      '2026-04',
    )
    const statement = await loadMonthlyStatement(db, generated.statementId)
    const line = statement?.lines[0]
    expect(line).toBeDefined()

    const logIds = await adjustMonthlyStatementLine(db, line!.id, 40, '现场复核扣减')
    expect(logIds).toHaveLength(2)
    const adjusted = await loadMonthlyStatement(db, generated.statementId)
    expect(adjusted).toMatchObject({
      status: 'draft',
      totalAmount: 1440,
    })
    expect(adjusted?.lines[0]).toMatchObject({
      autoQty: 42,
      adjustedQty: 40,
      effectiveQty: 40,
      amount: 1440,
      note: '现场复核扣减',
    })
  })

  it('rejects quantity adjustments after the owner report has been submitted', async () => {
    const generated = await generateMonthlyStatement(
      db,
      'proj_demo_001',
      'con_demo_sg01',
      '2026-04',
    )
    const statement = await loadMonthlyStatement(db, generated.statementId)
    const line = statement?.lines[0]
    expect(line).toBeDefined()

    await db.execute(
      `UPDATE monthly_statements SET status = 'adjusted' WHERE id = ?`,
      [generated.statementId],
    )

    await expect(adjustMonthlyStatementLine(
      db,
      line!.id,
      40,
      '已申报后不允许从清单工作台更改',
    )).rejects.toThrow('只有草稿状态')
  })
})
