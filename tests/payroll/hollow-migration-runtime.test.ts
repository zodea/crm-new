import type { PayrollC1Action, PayrollC1CommandRead } from '../../app/lib/payroll/central-c1-contract'
import { afterEach, expect, it } from 'vitest'
import { decodePayrollARead, encodePayrollAWire } from '../../app/lib/payroll/central-a-codec'
import { decodePayrollC1Read, encodePayrollC1Wire } from '../../app/lib/payroll/central-c1-codec'
import { decodePayrollC2Read, encodePayrollC2Wire } from '../../app/lib/payroll/central-c2-codec'
import { payrollC2OriginalOutput } from '../../app/lib/payroll/central-c2-output-identity'
import { PAYROLL_HOLLOW_DEDUCTION_TABLES } from '../../app/lib/payroll/central-hollow-deduction-schema'
import { transformPayrollC2Wire } from '../../app/lib/payroll/central-payroll-wire'
import { loadPayrollMigratedHollow } from '../../server/utils/payroll-migrated-hollow'
import { createPayrollCHollowFixture } from '../helpers/payroll-c-hollow-fixture'
import { createPayrollHollowFixture } from '../helpers/payroll-hollow-fixture'
import { importPayrollHollowFixture } from '../helpers/payroll-hollow-migration-fixture'
import { cloneQuantityHollowSnapshot } from '../helpers/quantity-hollow-migration-fixture'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
})

it.each((PAYROLL_HOLLOW_DEDUCTION_TABLES).map(input => ({ input })))('真实原检查19整改4与工资550整体迁入，公开冻结输出和后月已处理450保留：输入案例 %#', async ({ input: table }) => {
  const original = await createPayrollHollowFixture()
  closers.push(original.close)
  let read = await original.form()
  const saved = await original.service.execute(original.command(read, { kind: 'save-a-draft', draft: original.draft }))
  const statementId = saved.statementId!
  read = await original.service.aForm({ origin: 'real' }, { statementId })
  await original.service.executeHollow(original.startCommand(read.hollow!))
  read = await original.service.aForm({ origin: 'real' }, { statementId })
  await original.service.execute(original.command(read, { kind: 'check-a' }))
  read = await original.service.aForm({ origin: 'real' }, { statementId })
  await original.service.execute(original.command(read, { kind: 'release-a', release: { actualAmount: 550, allocations: [{ workerId: original.draft.leaderWorkerId, amount: 550 }] } }))
  const sourceOutput = await original.service.aOutput({ origin: 'real' }, statementId)
  expect(sourceOutput.state).toBe('available')
  const f = await importPayrollHollowFixture(original.db, original.identities)
  closers.push(f.close)
  const mappedStatement = f.id('wage_statements', statementId)
  const output = await f.service.aOutput({ origin: 'real' }, mappedStatement)
  expect(output.state).toBe('available')
  if (output.state !== 'available' || sourceOutput.state !== 'available')
    throw new Error(JSON.stringify(output))
  expect(output.document.actualAmount).toBe(550)
  expect(output.document.hollow?.adoptions[0]?.line.proof.fingerprint).toBe(sourceOutput.document.hollow?.adoptions[0]?.line.proof.fingerprint)
  expect(output.document.hollow?.adoptions[0]?.line.recordId).toBe(f.recordId)
  expect(decodePayrollARead(encodePayrollAWire(output), 'output', { origin: 'real' }, mappedStatement)).toEqual(output)
  const next = await f.service.aForm({ origin: 'real' }, { statementId: null, draftKey: 'migrated-hollow-september', draft: { ...original.draft, projectId: f.scope.projectId, leaderWorkerId: f.id('workers', original.draft.leaderWorkerId), memberWorkerIds: original.draft.memberWorkerIds.map(id => f.id('workers', id)), month: '2026-09' } })
  expect(next.hollow?.totals.previousProcessed.value).toBe(450)
  expect(next.totals.grossAmount.value, JSON.stringify({ blockers: next.blockers, totals: next.totals, hollow: next.hollow?.reasons })).toBe(0)
  const projection = await f.instance.withWorkspaceTransaction(tx => loadPayrollMigratedHollow(tx, f.scope.projectId))
  expect(projection.adoptions.size).toBe(1)
  const repeated = await f.instance.prepareMigrationSnapshot(f.core.snapshot(f.session))
  repeated.commit()
  expect((await f.reloadPayroll().aOutput({ origin: 'real' }, mappedStatement)).state).toBe('available')
  await f.rollback()
  expect(await f.instance.withWorkspaceTransaction(tx => tx.select(`SELECT * FROM ${table}`))).toEqual([])
}, 30_000)

it.each(['C1', 'C2'] as const)('%s真实原检查与550实发迁入，原签字事实和受控身份同时保留', async (format) => {
  const original = await createPayrollCHollowFixture(format)
  closers.push(original.close)
  let statementId: string
  if (format === 'C1') {
    const initial = await original.service.c1Form({ origin: 'real' }, { statementId: null, draftKey: 'migration-c1', draft: original.draft })
    statementId = (await original.service.executeC1(original.c1Command(initial, { kind: 'save-c1-draft', draft: original.draft }))).statementId!
    let read = await original.service.c1Form({ origin: 'real' }, { statementId })
    await original.service.executeHollow(original.startCommand(read.hollow!))
    read = await original.service.c1Form({ origin: 'real' }, { statementId })
    await original.service.executeC1(original.c1Command(read, { kind: 'check-c1' }))
    read = await original.service.c1Form({ origin: 'real' }, { statementId })
    await original.service.executeC1(original.c1Command(read, { kind: 'release-c1', release: { actualAmount: 550, allocations: [{ workerId: original.draft.leaderWorkerId, amount: 550 }] } }))
  }
  else {
    const initial = await original.service.c2Form({ origin: 'real' }, { statementId: null, draftKey: 'migration-c2', draft: original.draft })
    statementId = (await original.service.executeC2(original.c2Command(initial, { kind: 'save-c2-draft', draft: original.draft }))).statementId!
    let read = await original.service.c2Form({ origin: 'real' }, { statementId })
    await original.service.executeHollow(original.startCommand(read.hollow!))
    read = await original.service.c2Form({ origin: 'real' }, { statementId })
    await original.service.executeC2(original.c2Command(read, { kind: 'check-c2' }))
    read = await original.service.c2Form({ origin: 'real' }, { statementId })
    await original.service.executeC2(original.c2Command(read, { kind: 'release-c2', release: { actualAmount: 550, allocations: [{ workerId: original.draft.leaderWorkerId, amount: 550 }] } }))
  }
  const f = await importPayrollHollowFixture(original.db, original.identities)
  closers.push(f.close)
  const mapped = f.id('wage_statements', statementId)
  const output = format === 'C1' ? await f.service.c1Output({ origin: 'real' }, mapped) : await f.service.c2Output({ origin: 'real' }, mapped)
  expect(output.state).toBe('available')
  if (output.state !== 'available')
    throw new Error(JSON.stringify(output))
  expect(output.document.actualAmount).toBe(550)
  expect(output.document.hollow?.adoptions[0]?.line.recordId).toBe(f.recordId)
  if (format === 'C2') {
    const before = await original.service.c2Output({ origin: 'real' }, statementId)
    if (before.state !== 'available')
      throw new Error('原 C2 输出不可用')
    const restored = payrollC2OriginalOutput(output.document)
    expect(restored).not.toBeNull()
    expect({ ...restored, identityMapping: undefined }).toEqual({ ...before.document, identityMapping: undefined })
    const decoded = transformPayrollC2Wire(encodePayrollC2Wire(output), true) as typeof output
    expect(payrollC2OriginalOutput(decoded.document)).toEqual(restored)
  }
  const decode = format === 'C1' ? decodePayrollC1Read(encodePayrollC1Wire(output), 'output', { origin: 'real' }, mapped) : decodePayrollC2Read(encodePayrollC2Wire(output), 'output', { origin: 'real' }, mapped)
  expect(decode).toEqual(output)
  let nextStatement: string | null = null
  if (format === 'C1') {
    const current = await f.quantityService.hollow(f.scope)
    await f.quantityService.executeHollow(f.command(current, { kind: 'rectify-hollow-inspection', recordId: f.recordId, expectedRevisionId: current.data.records[0]!.inspection.revisionId, rectifiedOn: '2026-09-01', count: 3, note: '迁入后再次真实复核三处' }))
    const draft = { ...original.draft, projectId: f.scope.projectId, leaderWorkerId: f.id('workers', original.draft.leaderWorkerId), memberWorkerIds: original.draft.memberWorkerIds.map(id => f.id('workers', id)), month: '2026-09' }
    const matrix = await f.service.attendanceMatrix({ origin: 'real' }, { projectId: draft.projectId, month: draft.month, crewId: null })
    await f.service.executeAttendance({ commandId: 'migration-next-attendance', workspaceId: matrix.context.workspaceId, actorId: matrix.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: matrix.context.sourceVersion, projectId: draft.projectId, scope: matrix.scope, action: { kind: 'upsert-attendance', record: { workerId: draft.leaderWorkerId, crewId: null, workDate: '2026-09-01', hours: 8, overtimeHours: 0, workContent: '后月真实一天', note: '' } } })
    let sequence = 0
    const command = (read: PayrollC1CommandRead, action: PayrollC1Action) => ({ commandId: `migration-native-next-${++sequence}`, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId: draft.projectId, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: null, action })
    let read = await f.service.c1Form({ origin: 'real' }, { statementId: null, draftKey: 'migration-native-september', draft })
    nextStatement = (await f.service.executeC1(command(read, { kind: 'save-c1-draft', draft }))).statementId!
    read = await f.service.c1Form({ origin: 'real' }, { statementId: nextStatement })
    expect(read.hollow?.snapshot?.facts[0]?.remainingCount).toBe(12)
    expect(read.hollow?.totals.previousProcessed.value).toBe(450)
    expect(read.totals.grossAmount.value).toBe(1000)
    await f.service.executeC1(command(read, { kind: 'check-c1' }))
    read = await f.service.c1Form({ origin: 'real' }, { statementId: nextStatement })
    await f.service.executeC1(command(read, { kind: 'release-c1', release: { actualAmount: 1000, allocations: [{ workerId: draft.leaderWorkerId, amount: 1000 }] } }))
    expect((await f.service.c1Output({ origin: 'real' }, nextStatement)).state).toBe('available')
    await expect(f.rollback()).rejects.toThrow()
  }
  const cloned = await cloneQuantityHollowSnapshot(await f.instance.exportSnapshotBytes())
  try {
    const second = await importPayrollHollowFixture(cloned, f.identities)
    closers.push(second.close)
    const nextId = second.id('wage_statements', mapped)
    const again = format === 'C1' ? await second.service.c1Output({ origin: 'real' }, nextId) : await second.service.c2Output({ origin: 'real' }, nextId)
    expect(again.state).toBe('available')
    if (again.state !== 'available')
      throw new Error(JSON.stringify(again))
    expect(again.document.actualAmount).toBe(550)
    if (format === 'C2') {
      expect(decodePayrollC2Read(encodePayrollC2Wire(again), 'output', { origin: 'real' }, nextId)).toEqual(again)
      expect({ ...payrollC2OriginalOutput(again.document), identityMapping: undefined }).toEqual({ ...payrollC2OriginalOutput(output.document), identityMapping: undefined })
    }
    else {
      expect(decodePayrollC1Read(encodePayrollC1Wire(again), 'output', { origin: 'real' }, nextId)).toEqual(again)
      const later = await second.service.c1Output({ origin: 'real' }, second.id('wage_statements', nextStatement!))
      expect(later.state).toBe('available')
      if (later.state !== 'available')
        throw new Error(JSON.stringify(later))
      expect(later.document.actualAmount).toBe(1000)
      expect(later.document.hollow?.facts[0]?.remainingCount).toBe(12)
      expect(later.document.hollow?.totals.previousProcessed.value).toBe(450)
      expect(later.document.hollow?.adoptions).toEqual([])
    }
  }
  finally { cloned.close() }
  if (format === 'C2')
    await f.rollback()
}, 30_000)
