import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { readPayrollStatement } from '~/lib/payroll/central-read'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb
beforeEach(async () => {
  db = await createMemoryDb()
  await runMigrations(db)
  await db.execute('INSERT INTO projects(id,name,code) VALUES (\'p\',\'当前项目\',\'P\')')
  await db.execute('INSERT INTO workers(id,name,trade) VALUES (\'w\',\'当前姓名\',\'泥工\'),(\'zero\',\'零分配成员\',\'泥工\')')
})
afterEach(() => db.close())
async function released(raw: string | null) {
  await db.execute(`INSERT INTO wage_statements(id,project_id,leader_worker_id,month,format_family,quantity_source,status,actual_amount,snapshot_json)
    VALUES ('s','p','w','2026-02','C2','field','released',77,?)`, [raw])
}
describe('工资中央完整历史读取', () => {
  it('缺失冻结字段以业务名称诊断，完整原文仍可核对', async () => {
    const raw = JSON.stringify({ month: '2026-01' })
    await released(raw)
    const detail = await readPayrollStatement(db, 's')
    expect(detail.snapshot.issues).toContain('发放快照缺少核算应发金额')
    expect(detail.snapshot.issues).toContain('发放快照缺少来源版本')
    expect(detail.snapshot.issues).not.toContain('发放快照缺少 grossAmount')
    expect(detail.snapshot.raw).toBe(raw)
  })
  it('已发月份与格式来自原快照，不能被当前行重写', async () => {
    const snapshot = { projectName: '发放时项目', leaderName: '发放时姓名', month: '2026-01', formatFamily: 'C1', periodKind: 'monthly', quantitySource: 'field', payRatio: 0.8, sourceVersion: 'frozen-v1', sourceUpdatedAt: null, cumulativeAmount: 8, previouslyPaid: 0, grossAmount: 8, actualAmount: 0, memberWorkerIds: ['w', 'zero'], members: [], lines: [], allocations: [], allocationRecorded: true, subjectConfig: { id: 'cfg', unitRate: 18, ruleText: '原规则' }, extra: { raw: [null, 0, '旧内容'] } }
    await released(JSON.stringify(snapshot))
    const detail = await readPayrollStatement(db, 's')
    expect(detail).toMatchObject({ month: '2026-01', formatFamily: 'C1', actualAmount: 0 })
    expect(detail.snapshot.data).toEqual(snapshot)
    expect(detail.snapshot.raw).toBe(JSON.stringify(snapshot))
  })
  it('已发快照损坏时不以当前行金额和姓名补成发放事实', async () => {
    await released('{bad')
    const detail = await readPayrollStatement(db, 's')
    expect(detail).toMatchObject({ actualAmount: null, leaderName: null })
  })
})
