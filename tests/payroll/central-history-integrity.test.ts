import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readPayrollStatement } from '~/lib/payroll/central-read'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let db: TestDb
beforeEach(async () => {
  db = await createMigratedMemoryDb()
  await db.execute('INSERT INTO projects(id,name) VALUES (\'p\',\'现在的工程名称\')')
  await db.execute('INSERT INTO workers(id,name) VALUES (\'leader\',\'现在的负责人姓名\'),(\'zero\',\'现在的零成员姓名\')')
})
afterEach(() => db.close())

function frozenHistory() {
  return {
    projectName: '发放时工程名称',
    crewName: null,
    leaderName: '发放时负责人姓名',
    month: '2026-08',
    periodKind: 'monthly',
    formatFamily: 'C1',
    quantitySource: 'field',
    sourceVersion: 'historical-source',
    sourceUpdatedAt: '2026-08-31 08:00:00',
    payRatio: 1,
    cumulativeAmount: 300,
    previouslyPaid: 0,
    grossAmount: 300,
    actualAmount: 300,
    actualAmountFen: 30000,
    allocationTotalFen: 30000,
    allocationRecorded: true,
    operatorName: '原经办人',
    submittedAt: '2026-08-31 09:00:00',
    memberWorkerIds: ['leader', 'zero'],
    members: [
      { workerId: 'leader', workerName: '发放时负责人姓名', isLeader: true },
      { workerId: 'zero', workerName: '发放时零成员姓名', isLeader: false },
    ],
    allocations: [
      { workerId: 'leader', workerName: '发放时负责人姓名', isLeader: true, amount: 300, allocatedAmountFen: 30000 },
      { workerId: 'zero', workerName: '发放时零成员姓名', isLeader: false, amount: 0, allocatedAmountFen: 0 },
    ],
    lines: [{ id: 'old-line', workerId: 'leader', itemId: null, itemName: '正常工时', unit: '小时', quantity: 8, unitPrice: 37.5, amount: 300 }],
    dayworkRecords: [] as unknown[],
    subjectConfig: null as Record<string, unknown> | null,
    futureExtension: { originalIdentity: '不能裁掉的历史字段', amount: null },
  }
}

async function saveLegacy(raw: string | null, format = 'C1') {
  await db.execute(`INSERT INTO wage_statements(id,project_id,leader_worker_id,month,format_family,quantity_source,status,actual_amount,snapshot_json)
    VALUES ('s','p','leader','2026-08',?,'field','released',100,?)`, [format, raw])
  await db.execute(`INSERT INTO wage_statement_members(id,statement_id,worker_id,is_leader)
    VALUES ('m-leader','s','leader',1),('m-zero','s','zero',0)`)
}

describe('工资中央历史原值与冻结完整性', () => {
  it('旧行没有姓名字段时从同一快照成员解释，原表和冻结金额分别保留', async () => {
    const snapshot = frozenHistory()
    const raw = JSON.stringify(snapshot)
    await saveLegacy(raw)
    const detail = await readPayrollStatement(db, 's')
    expect(detail.snapshot.state).toBe('complete')
    expect(detail.snapshot.raw).toBe(raw)
    expect(detail.snapshot.data).toEqual(snapshot)
    expect(detail.lines[0]).toMatchObject({ workerName: '发放时负责人姓名', amount: 300 })
    expect(detail).toMatchObject({ actualAmount: 300, stored: { head: { actual_amount: 100 } } })
    expect(detail.diagnostics).toContainEqual(expect.objectContaining({ code: 'snapshot-row-mismatch' }))
  })

  it.each([null, '{broken'])('没有可信冻结资料时保留原行100，不把它代填成已发事实：%s', async (raw) => {
    await saveLegacy(raw)
    const detail = await readPayrollStatement(db, 's')
    expect(detail.actualAmount).toBeNull()
    expect(detail.leaderName).toBeNull()
    expect(detail.stored.head.actual_amount).toBe(100)
    expect(detail.snapshot.raw).toBe(raw)
    expect(detail.snapshot.state).toBe(raw === null ? 'missing' : 'invalid')
  })

  it('分配缺少零成员也属于部分历史，不能因总金额相等标为完整', async () => {
    const snapshot = frozenHistory()
    snapshot.allocations = [snapshot.allocations[0]!]
    await saveLegacy(JSON.stringify(snapshot))
    const detail = await readPayrollStatement(db, 's')
    expect(detail.snapshot.state).toBe('partial')
    expect(detail.snapshot.issues.length).toBeGreaterThan(0)
    expect(detail.actualAmount).toBe(300)
  })

  it('零分配且没有工资行的成员软删后，原已发月份锁仍可查证', async () => {
    await saveLegacy(JSON.stringify(frozenHistory()))
    await db.execute('UPDATE wage_statement_members SET deleted_at=\'2026-09-01\' WHERE worker_id=\'zero\'')
    const detail = await readPayrollStatement(db, 's')
    expect(detail.lines.some(row => row.workerId === 'zero')).toBe(false)
    expect(detail.allocations.find(row => row.workerId === 'zero')?.amount).toBe(0)
    expect(detail.locks).toContainEqual(expect.objectContaining({ month: '2026-08', workerId: 'zero', kind: 'released-month' }))
    expect(detail.stored.members.find(row => row.workerId === 'zero')?.deletedAt).toBe('2026-09-01')
  })

  it('c2 快照有签工数组但记录正文损坏时保原文并标为部分历史', async () => {
    const snapshot = frozenHistory()
    snapshot.formatFamily = 'C2'
    snapshot.subjectConfig = { id: 'old-config', unitRate: 300, ruleText: '人工确认旧规则' }
    snapshot.dayworkRecords = [{ id: 'old-daywork', workerId: 'leader', laborUnits: null }, '损坏的旧条目']
    const raw = JSON.stringify(snapshot)
    await saveLegacy(raw, 'C2')
    const detail = await readPayrollStatement(db, 's')
    expect(detail.snapshot.raw).toBe(raw)
    expect(detail.snapshot.data?.dayworkRecords).toEqual(snapshot.dayworkRecords)
    expect(detail.snapshot.state).toBe('partial')
  })

  it.each(['members', 'allocations'] as const)('历史 %s 混入坏条目时不能滤掉后冒完整', async (field) => {
    const snapshot = frozenHistory()
    const raw = JSON.stringify({ ...snapshot, [field]: [...snapshot[field], null] })
    await saveLegacy(raw)
    const detail = await readPayrollStatement(db, 's')
    expect(detail.snapshot.raw).toBe(raw)
    expect(detail.snapshot.state).toBe('partial')
  })

  it('c2 已发300但签工快照为空时，保留实发并明确来源缺损', async () => {
    const snapshot = frozenHistory()
    snapshot.formatFamily = 'C2'
    snapshot.subjectConfig = { id: 'old-config', unitRate: 300, ruleText: '人工确认旧规则' }
    await saveLegacy(JSON.stringify(snapshot), 'C2')
    const detail = await readPayrollStatement(db, 's')
    expect(detail.actualAmount).toBe(300)
    expect(detail.snapshot.data?.dayworkRecords).toEqual([])
    expect(detail.snapshot.state).toBe('partial')
  })
})
