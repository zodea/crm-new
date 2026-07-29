import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import {
  checkWageStatement,
  createWageStatementDraft,
  loadWageStatement,
  releaseWageStatement,
} from '~/lib/payroll/statements'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb

const lines = [{
  workerId: 'worker-a',
  itemName: '墙砖铺贴',
  unit: '㎡',
  quantity: 100,
  unitPrice: 20,
}]

beforeEach(async () => {
  db = await createMemoryDb()
  await runMigrations(db)
  await db.execute(`INSERT INTO projects (id, name, code) VALUES ('project-a', '项目甲', 'PA')`)
  await db.execute(`INSERT INTO crews (id, name, trade) VALUES ('crew-a', '泥水班', '泥水工')`)
  await db.execute(`
    INSERT INTO workers (id, crew_id, name, trade, current_project_id)
    VALUES ('worker-a', 'crew-a', '张师傅', '泥水工', 'project-a')
  `)
})

afterEach(() => db.close())

async function createChecked(periodKind: 'monthly' | 'settlement', payRatio: number) {
  const id = await createWageStatementDraft(db, {
    projectId: 'project-a',
    crewId: 'crew-a',
    leaderWorkerId: 'worker-a',
    month: '2026-07',
    purpose: periodKind === 'monthly' ? 'advance' : 'final',
    periodKind,
    formatFamily: 'A',
    quantitySource: 'field',
    payRatio,
    lines,
    sourceVersion: 'field-v1',
  })
  await checkWageStatement(db, id, lines, {
    sourceVersion: 'field-v1',
    sourceUpdatedAt: '2026-07-20 09:00:00',
  })
  return id
}

describe('wage release safety', () => {
  it('recomputes released total when two statements were checked before either was released', async () => {
    const monthlyId = await createChecked('monthly', 0.8)
    const settlementId = await createChecked('settlement', 0.95)

    expect(await releaseWageStatement(db, monthlyId, 1500, {
      currentSourceVersion: 'field-v1',
    })).toBe('released')
    await expect(releaseWageStatement(db, settlementId, 1800, {
      currentSourceVersion: 'field-v1',
    })).rejects.toThrow('不能超过本次应发 400.00 元')

    expect(await releaseWageStatement(db, settlementId, 400, {
      currentSourceVersion: 'field-v1',
    })).toBe('released')
    expect(await loadWageStatement(db, settlementId)).toMatchObject({
      status: 'released',
      previouslyPaid: 1500,
      grossAmount: 400,
      actualAmount: 400,
    })
  })

  it('blocks a positive release when the recalculated payable is zero', async () => {
    const monthlyId = await createChecked('monthly', 0.8)
    const settlementId = await createChecked('settlement', 0.8)
    await releaseWageStatement(db, monthlyId, 1600, {
      currentSourceVersion: 'field-v1',
    })

    await expect(releaseWageStatement(db, settlementId, 1, {
      currentSourceVersion: 'field-v1',
    })).rejects.toThrow('本次应发为 0')
    expect(await loadWageStatement(db, settlementId)).toMatchObject({
      status: 'checked',
      actualAmount: null,
    })
  })

  it('normalizes to cents before deciding whether the actual release is positive', async () => {
    const statementId = await createChecked('monthly', 0.8)

    await expect(releaseWageStatement(db, statementId, 0.004, {
      currentSourceVersion: 'field-v1',
    })).rejects.toThrow('必须大于 0')
    expect(await loadWageStatement(db, statementId)).toMatchObject({
      status: 'checked',
      actualAmount: null,
    })
  })

  it('returns a business outcome so the caller can commit the recheck marker before reporting the error', async () => {
    const statementId = await createChecked('monthly', 0.8)

    await db.execute('BEGIN IMMEDIATE')
    const result = await releaseWageStatement(db, statementId, 1500, {
      currentSourceVersion: 'field-v2',
    })
    await db.execute('COMMIT')

    expect(result).toBe('needs_recheck')
    expect(await loadWageStatement(db, statementId)).toMatchObject({
      status: 'checked',
      needsRecheck: true,
    })
  })

  it('reads released names and lines from the frozen snapshot', async () => {
    const statementId = await createChecked('monthly', 0.8)
    await releaseWageStatement(db, statementId, 1500, {
      currentSourceVersion: 'field-v1',
      operatorName: '项目经理',
    })
    await db.execute(`UPDATE projects SET name = '已改项目名' WHERE id = 'project-a'`)
    await db.execute(`UPDATE crews SET name = '已改班组名' WHERE id = 'crew-a'`)
    await db.execute(`UPDATE workers SET name = '已改人员名' WHERE id = 'worker-a'`)
    await db.execute(`
      UPDATE wage_statement_lines
      SET item_name = '已改分项', quantity = 999, amount = 999
      WHERE statement_id = ?
    `, [statementId])

    expect(await loadWageStatement(db, statementId)).toMatchObject({
      projectName: '项目甲',
      crewName: '泥水班',
      leaderName: '张师傅',
      operatorName: '项目经理',
      lines: [expect.objectContaining({
        itemName: '墙砖铺贴',
        quantity: 100,
        amount: 2000,
      })],
    })
  })
})
