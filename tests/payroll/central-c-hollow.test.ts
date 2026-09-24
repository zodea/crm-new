import { expect, it } from 'vitest'
import { decodePayrollC1Read, encodePayrollC1Wire, isPayrollC1StatementSourceSnapshot, isPayrollC1StatementSourceSnapshotV2 } from '~/lib/payroll/central-c1-codec'
import { decodePayrollC2Read, encodePayrollC2Wire, isPayrollC2StatementSourceSnapshot, isPayrollC2StatementSourceSnapshotV2 } from '~/lib/payroll/central-c2-codec'
import { createPayrollCHollowFixture } from '../helpers/payroll-c-hollow-fixture'

it('c1真实考勤请款1000，明确启动15处后只发550并保持原检查冻结', async () => {
  const f = await createPayrollCHollowFixture('C1')
  try {
    const initial = await f.service.c1Form({ origin: 'real' }, { statementId: null, draftKey: 'hollow-new-c1', draft: f.draft })
    expect(initial.totals.grossAmount.value).toBe(1000)
    expect(initial.hollow?.rows).toHaveLength(1)
    const saved = await f.service.executeC1(f.c1Command(initial, { kind: 'save-c1-draft', draft: f.draft }))
    const statementId = saved.statementId!
    let read = await f.service.c1Form({ origin: 'real' }, { statementId })
    await f.service.executeHollow(f.startCommand(read.hollow!))
    read = await f.service.c1Form({ origin: 'real' }, { statementId })
    expect(read.totals.grossAmount.value).toBe(550)
    await f.service.executeC1(f.c1Command(read, { kind: 'check-c1' }))
    read = await f.service.c1Form({ origin: 'real' }, { statementId })
    await expect(f.service.executeC1(f.c1Command(read, { kind: 'release-c1', release: { actualAmount: 549.99, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 549.99 }] } }))).rejects.toThrow('部分')
    expect(await f.db.select('SELECT * FROM payroll_hollow_adoptions')).toEqual([])
    await f.service.executeC1(f.c1Command(read, { kind: 'release-c1', release: { actualAmount: 550, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 550 }] } }))
    const output = await f.service.c1Output({ origin: 'real' }, statementId)
    expect(output.state).toBe('available')
    expect(output.state === 'available' ? output.document.hollow?.totals.currentDeduction.value : null).toBe(450)
    expect(decodePayrollC1Read(encodePayrollC1Wire(output), 'output', { origin: 'real' }, statementId)).toEqual(output)
    expect(await f.db.select('SELECT actual_amount,gross_amount FROM wage_statements WHERE id=?', [statementId])).toEqual([{ actual_amount: 550, gross_amount: 550 }])
    const [savedSource] = await f.db.select<{ source_json: string }>('SELECT source_json FROM payroll_c1_statement_sources WHERE statement_id=?', [statementId])
    expect(isPayrollC1StatementSourceSnapshotV2(JSON.parse(savedSource!.source_json))).toBe(true)
    expect(isPayrollC1StatementSourceSnapshot(JSON.parse(savedSource!.source_json))).toBe(false)
    const [original] = await f.db.select<{ snapshot_json: string }>('SELECT snapshot_json FROM wage_statements WHERE id=?', [statementId])
    const current = await f.quantityService.hollow(f.scope)
    await f.quantityService.executeHollow(f.hollowCommand(current, { kind: 'rectify-hollow-inspection', recordId: f.recordId, expectedRevisionId: current.data.records[0]!.inspection.revisionId, rectifiedOn: '2026-09-01', count: 15, note: '后期完整整改' }))
    expect(await f.reloadPayroll().c1Output({ origin: 'real' }, statementId)).toMatchObject({ state: 'available', document: output.state === 'available' ? output.document : null })
    const frozen = await f.reloadPayroll().c1Form({ origin: 'real' }, { statementId })
    expect(frozen.hollow?.rows[0]?.fact.remainingCount).toBe(15)
    expect(frozen.hollow?.current?.rows[0]?.fact.remainingCount).toBe(0)
    expect(decodePayrollC1Read(encodePayrollC1Wire(frozen), 'form', { origin: 'real' }, { statementId })).toEqual(frozen)
    expect(await f.db.select('SELECT snapshot_json FROM wage_statements WHERE id=?', [statementId])).toEqual([original])
  }
  finally { await f.close() }
})

it('c2真实已确认签工请款1000，启动原15处扣450，签工与空鼓采用各保原归属', async () => {
  const f = await createPayrollCHollowFixture('C2')
  try {
    const initial = await f.service.c2Form({ origin: 'real' }, { statementId: null, draftKey: 'hollow-new-c2', draft: f.draft })
    expect(initial.totals.grossAmount.value).toBe(1000)
    expect(initial.hollow?.rows).toHaveLength(1)
    const saved = await f.service.executeC2(f.c2Command(initial, { kind: 'save-c2-draft', draft: f.draft }))
    const statementId = saved.statementId!
    let read = await f.service.c2Form({ origin: 'real' }, { statementId })
    await f.service.executeHollow(f.startCommand(read.hollow!))
    read = await f.service.c2Form({ origin: 'real' }, { statementId })
    expect(read.totals.grossAmount.value).toBe(550)
    await f.service.executeC2(f.c2Command(read, { kind: 'check-c2' }))
    read = await f.service.c2Form({ origin: 'real' }, { statementId })
    await f.service.executeC2(f.c2Command(read, { kind: 'release-c2', release: { actualAmount: 550, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 550 }] } }))
    const output = await f.service.c2Output({ origin: 'real' }, statementId)
    expect(output.state).toBe('available')
    expect(output.state === 'available' ? output.document.hollow?.adoptions.map(row => row.line.recordId) : null).toEqual([f.recordId])
    expect(decodePayrollC2Read(encodePayrollC2Wire(output), 'output', { origin: 'real' }, statementId)).toEqual(output)
    const [savedSource] = await f.db.select<{ source_json: string }>('SELECT source_json FROM payroll_c2_statement_sources WHERE statement_id=?', [statementId])
    expect(isPayrollC2StatementSourceSnapshotV2(JSON.parse(savedSource!.source_json))).toBe(true)
    expect(isPayrollC2StatementSourceSnapshot(JSON.parse(savedSource!.source_json))).toBe(false)
    expect(await f.db.select('SELECT id FROM wage_statement_daywork_records WHERE statement_id=? AND deleted_at IS NULL', [statementId])).toHaveLength(1)
    const current = await f.quantityService.hollow(f.scope)
    await f.quantityService.executeHollow(f.hollowCommand(current, { kind: 'rectify-hollow-inspection', recordId: f.recordId, expectedRevisionId: current.data.records[0]!.inspection.revisionId, rectifiedOn: '2026-09-01', count: 15, note: '发放后完整整改' }))
    const frozen = await f.reloadPayroll().c2Form({ origin: 'real' }, { statementId })
    expect(frozen.hollow?.rows[0]?.fact.remainingCount).toBe(15)
    expect(frozen.hollow?.current?.rows[0]?.fact.remainingCount).toBe(0)
    expect(decodePayrollC2Read(encodePayrollC2Wire(frozen), 'form', { origin: 'real' }, { statementId })).toEqual(frozen)
    await f.db.execute('DELETE FROM payroll_hollow_adoptions WHERE statement_id=?', [statementId])
    expect((await f.reloadPayroll().c2Output({ origin: 'real' }, statementId)).state).toBe('unavailable')
  }
  finally { await f.close() }
})

it('c1核对后追加整改使原启动需重核，失败读取仍可往返并保留原启动依据', async () => {
  const f = await createPayrollCHollowFixture('C1')
  try {
    const initial = await f.service.c1Form({ origin: 'real' }, { statementId: null, draftKey: 'hollow-stale-c1', draft: f.draft })
    const saved = await f.service.executeC1(f.c1Command(initial, { kind: 'save-c1-draft', draft: f.draft }))
    const statementId = saved.statementId!
    let read = await f.service.c1Form({ origin: 'real' }, { statementId })
    const started = await f.service.executeHollow(f.startCommand(read.hollow!))
    read = await f.service.c1Form({ origin: 'real' }, { statementId })
    await f.service.executeC1(f.c1Command(read, { kind: 'check-c1' }))
    read = await f.service.c1Form({ origin: 'real' }, { statementId })
    const oldRelease = f.c1Command(read, { kind: 'release-c1', release: { actualAmount: 550, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 550 }] } })
    const current = await f.quantityService.hollow(f.scope)
    await f.quantityService.executeHollow(f.hollowCommand(current, { kind: 'rectify-hollow-inspection', recordId: f.recordId, expectedRevisionId: current.data.records[0]!.inspection.revisionId, rectifiedOn: '2026-08-03', count: 1, note: '核对后追加一处整改' }))
    expect((await f.service.executeC1(oldRelease)).outcome).toBe('needs-recheck')
    const stale = await f.service.c1Form({ origin: 'real' }, { statementId })
    expect(stale.hollow?.snapshot?.start?.id).toBe(started.startId)
    expect(stale.hollow?.rows[0]!.fact.remainingCount).toBe(14)
    expect(stale.eligibility.canRelease).toBe(false)
    expect(decodePayrollC1Read(encodePayrollC1Wire(stale), 'form', { origin: 'real' }, { statementId })).toEqual(stale)
    expect(await f.db.select('SELECT * FROM payroll_hollow_adoptions')).toEqual([])
  }
  finally { await f.close() }
})
