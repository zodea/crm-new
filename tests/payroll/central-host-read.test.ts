import { expect, it } from 'vitest'
import { buildPayrollHostSection, decodePayrollHostSection, encodePayrollHostSection } from '~/lib/crew-worker/payroll-read'
import { loadPayrollHostSection } from '../../server/utils/crew-worker-payroll-read'
import { createPayrollAdjustmentFixture } from '../helpers/payroll-adjustment-service-fixture'

const session = { workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read', 'worker:list:read', 'crew:list:read', 'project:list:read'] }

it('项目、原班组及个人冷读同一1000实发与退40，更正不另计现金；零成员与后来转组保留', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const correction = await f.correct()
    const read = (kind: 'project' | 'crew' | 'worker', id: string) => f.withTransaction(tx => loadPayrollHostSection(tx, { kind, id }, session))
    expect((await read('project', 'p')).netAmount.value).toBe(1000)
    await f.refund(correction.adjustment.id, 40)
    await f.db.execute('UPDATE workers SET crew_id=\'next-crew\', name=\'后来姓名\' WHERE id=\'w\'')
    await f.db.execute('UPDATE wage_statements SET deleted_at=\'2026-09-01\' WHERE id=?', [f.statementId])
    const project = await read('project', 'p')
    const crew = await read('crew', 'crew')
    const worker = await read('worker', 'w')
    for (const section of [project, crew, worker]) {
      expect(section.netAmount.value).toBe(960)
      expect(section.rows.map(row => row.fact.kind)).toEqual(['initial-release', 'refund'])
      expect(new Set(section.rows.map(row => row.fact.identity)).size).toBe(2)
    }
    expect((await read('crew', 'next-crew')).rows).toEqual([])
    expect(worker.rows[0]!.fact.historicalMembers.find(m => m.workerId === 'w')?.name).toBe('负责人')
    const zero = await read('worker', 'zero')
    expect(zero.netAmount.value).toBe(0)
    expect(zero.rows[0]!.scopedAmount.value).toBe(0)
    const encoded = encodePayrollHostSection(worker)
    expect(encoded).toMatchObject({ netAmount: { value: '960.00' }, rows: [expect.objectContaining({ scopedAmount: { value: '1000.00', knownValue: '1000.00', state: 'known', reasons: [] } }), expect.anything()] })
    expect(decodePayrollHostSection(encoded, { kind: 'worker', id: 'w' })).toEqual(worker)
    expect(() => decodePayrollHostSection(encoded, { kind: 'worker', id: 'zero' })).toThrow('工资收付分区与原档案、实际来源或金额不一致，请重新读取')
  }
  finally { await f.close() }
})

it.each(Array.from([['worker:list:read'], ['payroll:read']]).map(input1 => ({ input1 })))('缺工资或目标页权限时返回无金额、姓名和来源的空分区，且不读数据库：输入案例 %#', async ({ input1: capabilities }) => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const result = await f.withTransaction(tx => loadPayrollHostSection(tx, { kind: 'worker', id: 'w' }, { ...session, capabilities }))
    expect(result.status).toBe('forbidden')
    expect(result.rows).toEqual([])
    expect(result.netAmount).toMatchObject({ value: null, knownValue: null, state: 'unknown' })
    expect(JSON.stringify(result)).not.toContain(f.statementId)
  }
  finally { await f.close() }
})

it('整单可证、个人分配缺损分别显示；同稳定实发去重，不能均分或取整单冒充个人', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const actual = await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })
    const fact = structuredClone(actual.rows[0]!)
    fact.allocations = []
    fact.allocationState = 'unknown'
    fact.qualification = 'historical-amount-proven'
    const facts = { ...actual, status: 'partial' as const, rows: [fact, fact] }
    const project = buildPayrollHostSection({ kind: 'project', id: 'p' }, facts)
    const worker = buildPayrollHostSection({ kind: 'worker', id: 'w' }, facts)
    expect(project.rows).toHaveLength(1)
    expect(project.netAmount.value).toBe(1000)
    expect(worker.rows).toHaveLength(1)
    expect(worker.rows[0]!.fact.signedAmount.value).toBe(1000)
    expect(worker.netAmount.value).toBeNull()
    expect(worker.netAmount.state).toBe('unknown')
    expect(() => decodePayrollHostSection(encodePayrollHostSection({ ...worker, netAmount: { value: 1000, knownValue: 1000, state: 'known', reasons: [] } }), worker.scope)).toThrow('工资收付分区与原档案、实际来源或金额不一致，请重新读取')
  }
  finally { await f.close() }
})

it('混合历史班组只按各组可证实际分配归集，不把整单各计1000；缺归属不能称完整', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const actual = await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })
    const fact = structuredClone(actual.rows[0]!)
    fact.historicalMembers = fact.historicalMembers.map(member => ({ ...member, crewId: member.workerId === 'w' ? 'crew' : 'next-crew' }))
    fact.allocations = fact.allocations.map(allocation => ({ ...allocation, crewId: allocation.workerId === 'w' ? 'crew' : 'next-crew', amount: allocation.workerId === 'w' ? 600 : allocation.workerId === 'member' ? 400 : 0 }))
    const mixed = { ...actual, rows: [fact] }
    expect(buildPayrollHostSection({ kind: 'crew', id: 'crew' }, mixed).netAmount.value).toBe(600)
    expect(buildPayrollHostSection({ kind: 'crew', id: 'next-crew' }, mixed).netAmount.value).toBe(400)
    fact.allocations = []
    fact.allocationState = 'unknown'
    fact.qualification = 'historical-amount-proven'
    expect(buildPayrollHostSection({ kind: 'crew', id: 'crew' }, mixed).netAmount.value).toBeNull()
    expect(buildPayrollHostSection({ kind: 'project', id: 'p' }, mixed).netAmount.value).toBe(1000)
  }
  finally { await f.close() }
})
