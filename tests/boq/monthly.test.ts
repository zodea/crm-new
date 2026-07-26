import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  adjustMonthlyStatementLine,
  generateMonthlyStatement,
  loadMonthlyStatement,
} from '~/lib/boq/monthly'
import { runMigrations } from '~/lib/db/migrations'
import { seedIfEmpty } from '~/lib/db/seed'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb

beforeEach(async () => {
  db = await createMemoryDb()
  await runMigrations(db)
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

  it('records manual adjustment trace without changing the automatic quantity', async () => {
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
      status: 'adjusted',
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
})
