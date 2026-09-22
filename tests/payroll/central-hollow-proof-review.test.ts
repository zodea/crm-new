import { expect, it } from 'vitest'
import { blankQuantityTemplateDraft } from '~/lib/quantity/template'
import { createPayrollCHollowFixture } from '../helpers/payroll-c-hollow-fixture'

it('非作者复核：未启动的已发单也核对完整采用物理集合，不接受后来未签入的采用行', async () => {
  const f = await createPayrollCHollowFixture('C1')
  try {
    const first = await f.service.c1Form({ origin: 'real' }, { statementId: null, draftKey: 'review-started-august', draft: f.draft })
    const august = await f.service.executeC1(f.c1Command(first, { kind: 'save-c1-draft', draft: f.draft }))
    const startedRead = await f.service.c1Form({ origin: 'real' }, { statementId: august.statementId! })
    const started = await f.service.executeHollow(f.startCommand(startedRead.hollow!))
    const draft = { ...f.draft, month: '2026-09' }
    const matrix = await f.service.attendanceMatrix({ origin: 'real' }, { projectId: draft.projectId, month: draft.month, crewId: null })
    await f.service.executeAttendance({ commandId: 'review-september-attendance', workspaceId: matrix.context.workspaceId, actorId: matrix.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: matrix.context.sourceVersion, projectId: draft.projectId, scope: matrix.scope, action: { kind: 'upsert-attendance', record: { workerId: draft.leaderWorkerId, crewId: null, workDate: '2026-09-01', hours: 8, overtimeHours: 0, workContent: '九月真实考勤', note: '' } } })
    let read = await f.service.c1Form({ origin: 'real' }, { statementId: null, draftKey: 'review-unstarted-september', draft })
    const saved = await f.service.executeC1(f.c1Command(read, { kind: 'save-c1-draft', draft }))
    const statementId = saved.statementId!
    read = await f.service.c1Form({ origin: 'real' }, { statementId })
    await f.service.executeC1(f.c1Command(read, { kind: 'check-c1' }))
    read = await f.service.c1Form({ origin: 'real' }, { statementId })
    await f.service.executeC1(f.c1Command(read, { kind: 'release-c1', release: { actualAmount: 1000, allocations: [{ workerId: draft.leaderWorkerId, amount: 1000 }] } }))
    expect((await f.service.c1Output({ origin: 'real' }, statementId)).state).toBe('available')
    await f.db.execute('INSERT INTO payroll_hollow_adoptions (id,project_id,statement_id,start_id,record_id,command_id,adoption_json,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)', ['unsigned-adoption', draft.projectId, statementId, started.startId, f.recordId, 'unsigned-command', '{}', read.context.actorId, '2026-09-15T00:00:00.000Z'])
    expect((await f.reloadPayroll().c1Output({ origin: 'real' }, statementId)).state).toBe('unavailable')
  }
  finally { await f.close() }
})

it('非作者复核：同一配置命令少一条修订时，不能只凭仍在的所用费率输出健康工资', async () => {
  const f = await createPayrollCHollowFixture('C1')
  try {
    const extra = blankQuantityTemplateDraft(f.draft.projectId)
    extra.code = 'POLICY-OTHER'
    extra.name = '另一个真实分项'
    extra.newItems = [{ key: 'floor', code: 'FLOOR', name: '地砖', section: '', trade: '泥水工', unit: '㎡', sortOrder: 1 }]
    extra.lines = [{ key: 'floor-line', id: null, roomKey: extra.rooms[0]!.key, itemId: 'floor', recognizedContractQty: null, contractQty: null, provisionalQty: null, fieldFormula: '1', fieldQty: 1, note: '', sortOrder: 1 }]
    await f.executeQuantity({ kind: 'save-template', draft: extra })
    const scope = { projectId: f.draft.projectId, crewId: null, leaderWorkerId: f.draft.leaderWorkerId, formatFamily: 'C1' as const, book: null }
    const config = await f.service.hollowConfig({ origin: 'real' }, { scope, month: f.draft.month })
    expect(config.policies).toHaveLength(2)
    const policies = config.policies.map(policy => ({ policyId: null, baseRevisionId: null, itemId: policy.itemId, enabled: true, unitAmount: 30, effectiveMonth: f.draft.month }))
    const configured = await f.service.executeHollow({ commandId: 'review-two-policies', workspaceId: config.context.workspaceId, actorId: config.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: config.context.sourceVersion, projectId: f.draft.projectId, target: null, config: config.query, action: { kind: 'save-hollow-policies', policies } })
    const initial = await f.service.c1Form({ origin: 'real' }, { statementId: null, draftKey: 'review-policy-c1', draft: f.draft })
    const saved = await f.service.executeC1(f.c1Command(initial, { kind: 'save-c1-draft', draft: f.draft }))
    const statementId = saved.statementId!
    let read = await f.service.c1Form({ origin: 'real' }, { statementId })
    await f.service.executeHollow(f.startCommand(read.hollow!))
    read = await f.service.c1Form({ origin: 'real' }, { statementId })
    await f.service.executeC1(f.c1Command(read, { kind: 'check-c1' }))
    read = await f.service.c1Form({ origin: 'real' }, { statementId })
    await f.service.executeC1(f.c1Command(read, { kind: 'release-c1', release: { actualAmount: 550, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 550 }] } }))
    expect((await f.service.c1Output({ origin: 'real' }, statementId)).state).toBe('available')
    const unusedIndex = policies.findIndex(policy => policy.itemId !== f.target.itemId)
    await f.db.execute('DELETE FROM payroll_hollow_policy_revisions WHERE id=?', [configured.policyRevisionIds[unusedIndex]])
    expect((await f.reloadPayroll().c1Output({ origin: 'real' }, statementId)).state).toBe('unavailable')
  }
  finally { await f.close() }
})

it('非作者复核：已采用空鼓的工资缺失同事务冻结日志时输出不得继续可证', async () => {
  const f = await createPayrollCHollowFixture('C1')
  try {
    const initial = await f.service.c1Form({ origin: 'real' }, { statementId: null, draftKey: 'review-release-log-c1', draft: f.draft })
    const saved = await f.service.executeC1(f.c1Command(initial, { kind: 'save-c1-draft', draft: f.draft }))
    const statementId = saved.statementId!
    let read = await f.service.c1Form({ origin: 'real' }, { statementId })
    await f.service.executeHollow(f.startCommand(read.hollow!))
    read = await f.service.c1Form({ origin: 'real' }, { statementId })
    await f.service.executeC1(f.c1Command(read, { kind: 'check-c1' }))
    read = await f.service.c1Form({ origin: 'real' }, { statementId })
    const released = await f.service.executeC1(f.c1Command(read, { kind: 'release-c1', release: { actualAmount: 550, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 550 }] } }))
    expect((await f.service.c1Output({ origin: 'real' }, statementId)).state).toBe('available')
    await f.db.execute(`DELETE FROM operation_logs WHERE table_name='wage_statements' AND record_id=? AND id IN (${released.logIds.map(() => '?').join(',')})`, [statementId, ...released.logIds])
    expect((await f.reloadPayroll().c1Output({ origin: 'real' }, statementId)).state).toBe('unavailable')
  }
  finally { await f.close() }
})
