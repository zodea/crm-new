import { expect, it } from 'vitest'
import { createPayrollC1ServiceFixture } from '../helpers/payroll-c1-service-fixture'
import { seedReleasedPayrollMigrationSource } from '../helpers/payroll-migration-source'

it('历史总额、个人分配与新写依据分别判断：缺个人分配仍保留可证300，不能均分或开放更正', async () => {
  const f = await createPayrollC1ServiceFixture()
  try {
    const old = await seedReleasedPayrollMigrationSource(f.db)
    const snapshot = JSON.parse(old.snapshot)
    delete snapshot.allocations
    snapshot.allocationRecorded = false
    await f.db.execute('UPDATE wage_statements SET snapshot_json=? WHERE id=?', [JSON.stringify(snapshot), old.statementId])
    const read = await f.service.actualLedger({ origin: 'real' }, { projectId: 'pay-healthy-project' })
    expect(read.netAmount).toMatchObject({ value: 300, state: 'known' })
    expect(read.rows).toHaveLength(1)
    expect(read.rows[0]).toMatchObject({ kind: 'initial-release', qualification: 'historical-amount-proven', allocationState: 'unknown', allocations: [] })
    expect(read.rows[0]!.historicalMembers.map(m => m.name)).toContain('冻结时负责人')
    await expect(f.service.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: null, draftKey: 'historical-correction', originalStatementId: old.statementId } })).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  }
  finally { await f.close() }
})

it('原快照缺失时实际额未知，不能取当前头300；明确原实发为0时保留真实零', async () => {
  const f = await createPayrollC1ServiceFixture()
  try {
    const old = await seedReleasedPayrollMigrationSource(f.db)
    await f.db.execute('UPDATE wage_statements SET snapshot_json=NULL WHERE id=?', [old.statementId])
    const unknown = await f.service.actualLedger({ origin: 'real' }, { projectId: 'pay-healthy-project' })
    expect(unknown.netAmount.value).toBeNull()
    expect(unknown.rows[0]).toMatchObject({ qualification: 'unproven', signedAmount: { value: null }, allocationState: 'unknown' })
    const snapshot = { ...JSON.parse(old.snapshot), actualAmount: 0, actualAmountFen: 0, allocationTotalFen: 0, allocations: [], allocationRecorded: false }
    await f.db.execute('UPDATE wage_statements SET actual_amount=0,snapshot_json=? WHERE id=?', [JSON.stringify(snapshot), old.statementId])
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'pay-healthy-project' })).netAmount).toMatchObject({ value: 0, state: 'known' })
  }
  finally { await f.close() }
})
