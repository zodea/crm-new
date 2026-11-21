import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checkWageStatement,
  createWageStatementDraft,
  loadWageStatement,
  releaseWageStatement,
  updateDraftLinePrice,
} from '~/lib/payroll/statements'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let db: TestDb
let statementId: string

beforeEach(async () => {
  db = await createMigratedMemoryDb()
  await db.execute('INSERT INTO projects (id, name, code) VALUES (\'project-a\', \'项目甲\', \'PA\')')
  await db.execute('INSERT INTO crews (id, name, trade) VALUES (\'crew-a\', \'泥水班\', \'泥水工\')')
  await db.execute(`INSERT INTO workers (id, crew_id, name, trade, current_project_id)
    VALUES ('worker-a', 'crew-a', '张师傅', '泥水工', 'project-a')`)
  statementId = await createWageStatementDraft(db, {
    projectId: 'project-a',
    crewId: 'crew-a',
    leaderWorkerId: 'worker-a',
    month: '2026-07',
    purpose: 'advance',
    formatFamily: 'A',
    periodKind: 'monthly',
    quantitySource: 'field',
    payRatio: 1,
    lines: [{ workerId: 'worker-a', itemName: '历史工资行', unit: '㎡', quantity: 10, unitPrice: 20 }],
  })
  // 只在隔离夹具中还原历史 B，现行新建入口仍不允许生成该格式。
  await db.execute('UPDATE wage_statements SET format_family = \'B\' WHERE id = ?', [statementId])
})

afterEach(() => db.close())

describe('退役 B 工资保留历史原值并拒绝写入', () => {
  it('历史草稿不能修改单价', async () => {
    const before = await loadWageStatement(db, statementId)
    await expect(updateDraftLinePrice(db, statementId, before!.lines[0]!.id!, 99))
      .rejects
      .toThrow('B 类工资已退役，历史记录只读')
    expect(await loadWageStatement(db, statementId)).toEqual(before)
  })

  it('历史草稿不能以新来源重新核对', async () => {
    const before = await loadWageStatement(db, statementId)
    await expect(checkWageStatement(db, statementId, [
      { workerId: 'worker-a', itemName: '新现场量', unit: '㎡', quantity: 100, unitPrice: 30 },
    ], { sourceVersion: 'new-field-version' }))
      .rejects
      .toThrow('B 类工资已退役，历史记录只读')
    expect(await loadWageStatement(db, statementId)).toEqual(before)
  })

  it('历史已核对单不能发放，即使调用者传入来源版本', async () => {
    await db.execute('UPDATE wage_statements SET status = \'checked\' WHERE id = ?', [statementId])
    const before = await loadWageStatement(db, statementId)
    await expect(releaseWageStatement(db, statementId, 100, { currentSourceVersion: 'legacy-version' }))
      .rejects
      .toThrow('B 类工资已退役，历史记录只读')
    expect(await loadWageStatement(db, statementId)).toEqual(before)
  })
})
