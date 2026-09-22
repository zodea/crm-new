import { expect, it } from 'vitest'
import { createCheckedPayrollC2, createPayrollC2ServiceFixture } from '../helpers/payroll-c2-service-fixture'

it('独立规格反例：真实发放的全员月锁在签工台账可见，零签工成员与状态筛空均不能丢锁', async () => {
  const f = await createPayrollC2ServiceFixture()
  try {
    const checked = await createCheckedPayrollC2(f)
    await f.service.executeC2(f.c2Command(checked, { kind: 'release-c2', release: { actualAmount: 500, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] } }))
    const output = await f.service.c2Output({ origin: 'real' }, checked.statementId!)
    expect(output.state).toBe('available')
    const ledger = await f.ledger()
    expect(ledger.records.map(row => row.workerId).sort()).toEqual(['member', 'w'])
    const lockedWorkers = (read: typeof ledger) => [...new Set(read.locks.filter(lock => lock.statementId === checked.statementId && lock.kind === 'released-month').map(lock => lock.workerId))].sort()
    expect(lockedWorkers(ledger)).toEqual(['member', 'w', 'zero'])
    const filtered = await f.service.dayworkList({ origin: 'real' }, { ...f.scope, dayworkStatuses: ['draft'] })
    expect(filtered.records).toEqual([])
    expect(lockedWorkers(filtered)).toEqual(['member', 'w', 'zero'])
  }
  finally { await f.close() }
})
