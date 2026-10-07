import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrations } from '~/lib/db/migrations'
import {
  checkWageStatement,
  createWageStatementDraft,
  loadWageStatement,
  releaseWageStatement,
} from '~/lib/payroll/statements'
import { createMigratedMemoryDb, listTables } from '../helpers/memory-db'

let db: TestDb

const lines = [{
  workerId: 'worker-leader',
  itemName: '墙砖铺贴',
  unit: '㎡',
  quantity: 100,
  unitPrice: 20,
}]

beforeEach(async () => {
  db = await createMigratedMemoryDb()
  await db.execute(`INSERT INTO projects (id, name, code) VALUES ('project-a', '项目甲', 'PA')`)
  await db.execute(`INSERT INTO crews (id, name, trade) VALUES ('crew-a', '泥水班', '泥水工')`)
  await db.execute(`
    INSERT INTO workers (id, crew_id, name, trade, current_project_id)
    VALUES
      ('worker-leader', 'crew-a', '张班长', '泥水工', 'project-a'),
      ('worker-member', 'crew-a', '李师傅', '泥水工', 'project-a'),
      ('worker-outsider', 'crew-a', '外部人员', '泥水工', 'project-a')
  `)
})

afterEach(() => db.close())

async function createChecked(): Promise<string> {
  const id = await createWageStatementDraft(db, {
    projectId: 'project-a',
    crewId: 'crew-a',
    leaderWorkerId: 'worker-leader',
    memberWorkerIds: ['worker-member'],
    month: '2026-07',
    purpose: 'advance',
    periodKind: 'monthly',
    formatFamily: 'A',
    quantitySource: 'field',
    payRatio: 1,
    lines,
    sourceVersion: 'field-v1',
  })
  await checkWageStatement(db, id, lines, {
    sourceVersion: 'field-v1',
    sourceUpdatedAt: '2026-07-20 09:00:00',
  })
  return id
}

describe('wage statement member allocations', () => {
  it('v31 creates the allocation table', async () => {
    expect(migrations.some(migration => migration.version === 31)).toBe(true)
    expect(await listTables(db)).toContain('wage_statement_allocations')
  })

  it('defaults the full actual amount to the leader', async () => {
    const statementId = await createChecked()
    expect(await releaseWageStatement(db, statementId, 1500, {
      currentSourceVersion: 'field-v1',
    })).toBe('released')
    expect(await loadWageStatement(db, statementId)).toMatchObject({
      allocationRecorded: true,
      allocations: [
        {
          workerId: 'worker-leader',
          workerName: '张班长',
          amount: 1500,
        },
        {
          workerId: 'worker-member',
          workerName: '李师傅',
          amount: 0,
        },
      ],
    })
  })

  it('persists an exact member split and freezes names in the release snapshot', async () => {
    const statementId = await createChecked()
    expect(await releaseWageStatement(
      db,
      statementId,
      1500,
      { currentSourceVersion: 'field-v1' },
      [
        { workerId: 'worker-leader', amount: 1000 },
        { workerId: 'worker-member', amount: 500 },
      ],
    )).toBe('released')
    expect(await db.select(`
      SELECT worker_id, allocated_amount_fen
      FROM wage_statement_allocations
      WHERE statement_id = ? AND deleted_at IS NULL
      ORDER BY allocated_amount_fen DESC
    `, [statementId])).toEqual([
      { worker_id: 'worker-leader', allocated_amount_fen: 100000 },
      { worker_id: 'worker-member', allocated_amount_fen: 50000 },
    ])
    await db.execute(`UPDATE workers SET name = '已改姓名' WHERE id IN ('worker-leader', 'worker-member')`)
    expect(await loadWageStatement(db, statementId)).toMatchObject({
      allocations: [
        { workerId: 'worker-leader', workerName: '张班长', amount: 1000 },
        { workerId: 'worker-member', workerName: '李师傅', amount: 500 },
      ],
    })
  })

  it('rejects mismatched totals, duplicate workers and non-members', async () => {
    const statementId = await createChecked()
    await expect(releaseWageStatement(
      db,
      statementId,
      1500,
      { currentSourceVersion: 'field-v1' },
      [
        { workerId: 'worker-leader', amount: 1000 },
        { workerId: 'worker-member', amount: 499.99 },
      ],
    )).rejects.toThrow('分配合计必须等于实际发放金额')
    await expect(releaseWageStatement(
      db,
      statementId,
      1500,
      { currentSourceVersion: 'field-v1' },
      [
        { workerId: 'worker-leader', amount: 1000 },
        { workerId: 'worker-leader', amount: 500 },
      ],
    )).rejects.toThrow('同一成员不能重复分配')
    await expect(releaseWageStatement(
      db,
      statementId,
      1500,
      { currentSourceVersion: 'field-v1' },
      [
        { workerId: 'worker-leader', amount: 1000 },
        { workerId: 'worker-outsider', amount: 500 },
      ],
    )).rejects.toThrow('只能分配给当前请款簿成员')
    await expect(releaseWageStatement(
      db,
      statementId,
      1500,
      { currentSourceVersion: 'field-v1' },
      [
        { workerId: 'worker-leader', amount: 1500 },
      ],
    )).rejects.toThrow('必须包含负责人和全部成员')
    await expect(releaseWageStatement(
      db,
      statementId,
      1500,
      { currentSourceVersion: 'field-v1' },
      [
        { workerId: 'worker-leader', amount: 999.999 },
        { workerId: 'worker-member', amount: 500.001 },
      ],
    )).rejects.toThrow('必须精确到分')
    expect(await loadWageStatement(db, statementId)).toMatchObject({
      status: 'checked',
      actualAmount: null,
      allocations: [],
    })
  })

  it('does not persist allocations when the checked source has changed', async () => {
    const statementId = await createChecked()
    expect(await releaseWageStatement(
      db,
      statementId,
      1500,
      { currentSourceVersion: 'field-v2' },
      [
        { workerId: 'worker-leader', amount: 1000 },
        { workerId: 'worker-member', amount: 500 },
      ],
    )).toBe('needs_recheck')
    expect(await db.select<{ count: number }>(`
      SELECT COUNT(*) AS count
      FROM wage_statement_allocations
      WHERE statement_id = ? AND deleted_at IS NULL
    `, [statementId])).toEqual([{ count: 0 }])
  })
})
