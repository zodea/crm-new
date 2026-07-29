import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { loadPayrollStatementDetail } from '~/lib/payroll/detail'
import {
  checkWageStatement,
  createWageStatementDraft,
  releaseWageStatement,
} from '~/lib/payroll/statements'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb

beforeEach(async () => {
  db = await createMemoryDb()
  await runMigrations(db)
  await db.execute(`
    INSERT INTO projects (id, name, code) VALUES ('project-a', '项目甲', 'PA')
  `)
  await db.execute(`
    INSERT INTO crews (id, name, trade) VALUES ('crew-a', '泥水班', '泥水工')
  `)
  await db.execute(`
    INSERT INTO workers (id, crew_id, name, trade, current_project_id)
    VALUES ('worker-a', 'crew-a', '张师傅', '泥水工', 'project-a')
  `)
})

afterEach(() => db.close())

async function createStatement() {
  return createWageStatementDraft(db, {
    projectId: 'project-a',
    crewId: 'crew-a',
    leaderWorkerId: 'worker-a',
    month: '2026-07',
    purpose: 'advance',
    formatFamily: 'A',
    periodKind: 'monthly',
    quantitySource: 'provisional',
    payRatio: 0.8,
    lines: [{
      workerId: 'worker-a',
      itemName: '墙砖铺贴',
      unit: '㎡',
      quantity: 100,
      unitPrice: 20,
    }],
  })
}

describe('payroll statement detail read model', () => {
  it('does not count draft calculations as formally paid wages', async () => {
    const id = await createStatement()

    expect(await loadPayrollStatementDetail(db, id)).toMatchObject({
      statement: {
        id,
        projectName: '项目甲',
        leaderName: '张师傅',
        status: 'draft',
      },
      summary: {
        memberCount: 1,
        lineCount: 1,
        calculationAmount: 2000,
        formalPaidAmount: 0,
        allocationTotal: null,
        allocationBalanced: null,
      },
    })
  })

  it('uses the released snapshot and recorded member allocation as formal amounts', async () => {
    const id = await createStatement()
    const checkedLines = [{
      workerId: 'worker-a',
      itemName: '墙砖铺贴',
      unit: '㎡',
      quantity: 90,
      unitPrice: 20,
    }]
    await checkWageStatement(db, id, checkedLines, { sourceVersion: 'field-v1' })
    await releaseWageStatement(
      db,
      id,
      1400,
      { currentSourceVersion: 'field-v1', operatorName: '项目经理' },
      [{ workerId: 'worker-a', amount: 1400 }],
    )

    expect(await loadPayrollStatementDetail(db, id)).toMatchObject({
      statement: {
        status: 'released',
        quantitySource: 'field',
        actualAmount: 1400,
        allocations: [{ workerId: 'worker-a', amount: 1400 }],
      },
      summary: {
        calculationAmount: 1800,
        formalPaidAmount: 1400,
        allocationTotal: 1400,
        allocationBalanced: true,
      },
    })
  })

  it('hides a statement when its real parent project is soft deleted', async () => {
    const id = await createStatement()
    await db.execute(`
      UPDATE projects
      SET deleted_at = '2026-07-29 10:00:00'
      WHERE id = 'project-a'
    `)

    expect(await loadPayrollStatementDetail(db, id)).toBeNull()
  })
})
