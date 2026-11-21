import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadPayrollStatementDetail } from '~/lib/payroll/detail'
import {
  checkWageStatement,
  createWageStatementDraft,
  listWageStatements,
  releaseWageStatement,
} from '~/lib/payroll/statements'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let db: TestDb

beforeEach(async () => {
  db = await createMigratedMemoryDb()
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

async function createStatement(month = '2026-07') {
  return createWageStatementDraft(db, {
    projectId: 'project-a',
    crewId: 'crew-a',
    leaderWorkerId: 'worker-a',
    month,
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
  it('queries multiple statuses with OR, supports single and cleared selection, and keeps other filters conjunctive', async () => {
    const draftId = await createStatement('2026-07')
    const checkedId = await createStatement('2026-08')
    const releasedId = await createStatement('2026-09')
    const lines = [{ workerId: 'worker-a', itemName: '墙砖铺贴', unit: '㎡', quantity: 100, unitPrice: 20 }]
    await checkWageStatement(db, checkedId, lines, { sourceVersion: 'field-v1' })
    await checkWageStatement(db, releasedId, lines, { sourceVersion: 'field-v1' })
    await releaseWageStatement(db, releasedId, 1400, { currentSourceVersion: 'field-v1' })
    const filter = { projectId: 'project-a', crewId: 'crew-a' }

    const multiple = await listWageStatements(db, { ...filter, status: ['draft', 'checked', 'draft'] })
    expect(multiple.map(statement => statement.id).sort()).toEqual([draftId, checkedId].sort())
    const single = await listWageStatements(db, { ...filter, status: ['checked'] })
    expect(single.map(statement => statement.id)).toEqual([checkedId])
    const legacySingle = await listWageStatements(db, { ...filter, status: 'released' })
    expect(legacySingle.map(statement => statement.id)).toEqual([releasedId])
    const cleared = await listWageStatements(db, { ...filter, status: [] })
    expect(cleared.map(statement => statement.id).sort()).toEqual([draftId, checkedId, releasedId].sort())
    const legacyCleared = await listWageStatements(db, { ...filter, status: '' })
    expect(legacyCleared.map(statement => statement.id).sort()).toEqual([draftId, checkedId, releasedId].sort())
    const monthOnly = await listWageStatements(db, { ...filter, month: '2026-08', status: ['draft', 'checked'] })
    expect(monthOnly.map(statement => statement.id)).toEqual([checkedId])
  })

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
