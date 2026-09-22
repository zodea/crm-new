import { expect, it } from 'vitest'
import { createPayrollCHollowFixture } from '../helpers/payroll-c-hollow-fixture'
import { createPayrollHollowFixture } from '../helpers/payroll-hollow-fixture'

it('非作者复核：八月已处理空鼓后补录七月真实C1工资，不得引用未来采用而发放后无法输出', async () => {
  const f = await createPayrollCHollowFixture('C1')
  try {
    const initial = await f.service.c1Form({ origin: 'real' }, { statementId: null, draftKey: 'month-order-august', draft: f.draft })
    const august = (await f.service.executeC1(f.c1Command(initial, { kind: 'save-c1-draft', draft: f.draft }))).statementId!
    const augustRead = () => f.service.c1Form({ origin: 'real' }, { statementId: august })
    await f.service.executeHollow(f.startCommand((await augustRead()).hollow!))
    await f.service.executeC1(f.c1Command(await augustRead(), { kind: 'check-c1' }))
    await f.service.executeC1(f.c1Command(await augustRead(), { kind: 'release-c1', release: { actualAmount: 550, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 550 }] } }))
    const original = await f.service.c1Output({ origin: 'real' }, august)
    const draft = { ...f.draft, month: '2026-07' }
    const matrix = await f.service.attendanceMatrix({ origin: 'real' }, { projectId: draft.projectId, month: draft.month, crewId: null })
    await f.service.executeAttendance({ commandId: 'month-order-july-attendance', workspaceId: matrix.context.workspaceId, actorId: matrix.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: matrix.context.sourceVersion, projectId: draft.projectId, scope: matrix.scope, action: { kind: 'upsert-attendance', record: { workerId: draft.leaderWorkerId, crewId: null, workDate: '2026-07-01', hours: 8, overtimeHours: 0, workContent: '补录七月已经核实的一天考勤', note: '' } } })
    const read = await f.service.c1Form({ origin: 'real' }, { statementId: null, draftKey: 'month-order-july', draft })
    expect(read.totals.grossAmount.value).toBe(1000)
    const july = (await f.service.executeC1(f.c1Command(read, { kind: 'save-c1-draft', draft }))).statementId!
    const julyRead = () => f.service.c1Form({ origin: 'real' }, { statementId: july })
    await f.service.executeC1(f.c1Command(await julyRead(), { kind: 'check-c1' }))
    const checked = await julyRead()
    expect(checked.eligibility.canRelease).toBe(true)
    expect(checked.hollow?.snapshot?.previousProcessed).toEqual([])
    await f.service.executeC1(f.c1Command(checked, { kind: 'release-c1', release: { actualAmount: 1000, allocations: [{ workerId: draft.leaderWorkerId, amount: 1000 }] } }))
    expect((await f.reloadPayroll().c1Output({ origin: 'real' }, july)).state).toBe('available')
    expect((await f.reloadPayroll().c1Output({ origin: 'real' }, august)).document).toEqual(original.document)
  }
  finally { await f.close() }
}, 30_000)

it('补录C2七月已确认签工不引用八月扣款，发放后可冷读且八月原件不变', async () => {
  const f = await createPayrollCHollowFixture('C2')
  try {
    const initial = await f.service.c2Form({ origin: 'real' }, { statementId: null, draftKey: 'month-order-c2-august', draft: f.draft })
    const august = (await f.service.executeC2(f.c2Command(initial, { kind: 'save-c2-draft', draft: f.draft }))).statementId!
    const augustRead = () => f.service.c2Form({ origin: 'real' }, { statementId: august })
    await f.service.executeHollow(f.startCommand((await augustRead()).hollow!))
    await f.service.executeC2(f.c2Command(await augustRead(), { kind: 'check-c2' }))
    await f.service.executeC2(f.c2Command(await augustRead(), { kind: 'release-c2', release: { actualAmount: 550, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 550 }] } }))
    const original = await f.service.c2Output({ origin: 'real' }, august)
    const draft = { ...f.draft, month: '2026-07' }
    const record = { projectId: draft.projectId, crewId: null, workerId: draft.leaderWorkerId, workDate: '2026-07-01', workContent: '补录已确认七月签工', startTime: '08:00', endTime: '17:00', laborUnits: 1, witness: '原现场证明人', confirmedOn: '2026-07-02', status: 'confirmed' as const, note: '' }
    const daywork = await f.service.dayworkForm({ origin: 'real' }, { recordId: null, draftKey: 'month-order-c2-july-daywork', draft: record })
    await f.service.executeDaywork({ commandId: 'month-order-july-daywork', workspaceId: daywork.context.workspaceId, actorId: daywork.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: daywork.context.sourceVersion, projectId: draft.projectId, recordId: null, draftKey: daywork.draftKey, originalScope: null, action: { kind: 'save-daywork', record } })
    const read = await f.service.c2Form({ origin: 'real' }, { statementId: null, draftKey: 'month-order-c2-july', draft })
    const july = (await f.service.executeC2(f.c2Command(read, { kind: 'save-c2-draft', draft }))).statementId!
    const julyRead = () => f.service.c2Form({ origin: 'real' }, { statementId: july })
    await f.service.executeC2(f.c2Command(await julyRead(), { kind: 'check-c2' }))
    const checked = await julyRead()
    expect(checked.totals.grossAmount.value).toBe(1000)
    expect(checked.eligibility.canRelease).toBe(true)
    expect(checked.hollow?.snapshot?.previousProcessed).toEqual([])
    await f.service.executeC2(f.c2Command(checked, { kind: 'release-c2', release: { actualAmount: 1000, allocations: [{ workerId: draft.leaderWorkerId, amount: 1000 }] } }))
    expect((await f.reloadPayroll().c2Output({ origin: 'real' }, july)).state).toBe('available')
    expect((await f.reloadPayroll().c2Output({ origin: 'real' }, august)).document).toEqual(original.document)
  }
  finally { await f.close() }
}, 30_000)

it('读取A更早月份不把八月处理额带入累计基数，后月已处理450仍保留', async () => {
  const f = await createPayrollHollowFixture()
  try {
    const initial = await f.form()
    const august = (await f.service.execute(f.command(initial, { kind: 'save-a-draft', draft: f.draft }))).statementId!
    const augustRead = () => f.service.aForm({ origin: 'real' }, { statementId: august })
    await f.service.executeHollow(f.startCommand((await augustRead()).hollow!))
    await f.service.execute(f.command(await augustRead(), { kind: 'check-a' }))
    await f.service.execute(f.command(await augustRead(), { kind: 'release-a', release: { actualAmount: 550, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 550 }] } }))
    const original = await f.service.aOutput({ origin: 'real' }, august)
    const july = await f.form({ month: '2026-07' }, 'month-order-a-july')
    expect(july.hollow?.snapshot?.previousProcessed).toEqual([])
    expect(july.hollow?.totals.previousProcessed.value).toBe(0)
    const september = await f.form({ month: '2026-09' }, 'month-order-a-september')
    expect(september.hollow?.totals.previousProcessed.value).toBe(450)
    expect(september.totals.grossAmount.value).toBe(0)
    expect(september.hollow?.rows[0]?.state).toBe('already-processed')
    expect(await f.reloadPayroll().aOutput({ origin: 'real' }, august)).toEqual(original)
  }
  finally { await f.close() }
}, 30_000)
