import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollActualPaymentDetailRead, PayrollActualPaymentFormInput, PayrollActualPaymentFormRead, PayrollActualPaymentSnapshot } from '../../app/lib/payroll/central-actual-contract'
import type { PayrollActualPaymentCommand, PayrollAdjustmentCommandResult } from '../../app/lib/payroll/central-adjustment-contract'
import type { PayrollQuery, PayrollWritableContext } from '../../app/lib/payroll/central-contract'
import type { PayrollRun } from './payroll-service'
import { assertPayrollActualCommand, assertPayrollActualDraft, assertPayrollActualTarget } from '../../app/lib/payroll/central-actual-validation'
import { decodePayrollAdjustmentResult } from '../../app/lib/payroll/central-adjustment-codec'
import { payrollCanonical, payrollWriteRow } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { wireCent, wireDate } from '../../app/lib/payroll/central-payroll-wire'
import { advancePayrollRevision, payrollRevision } from '../../app/lib/payroll/central-schema'
import { amountInCents } from '../../app/lib/payroll/statements'
import { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { generateId } from '../../app/lib/util/id'
import { loadPayrollActualFacts } from './payroll-actual-facts'
import { payrollAdjustmentHash as hash, loadPayrollAdjustmentOriginal } from './payroll-adjustment-facts'
import { loadPayrollAdjustmentBalance, loadPayrollAdjustmentRows, readPayrollAdjustmentRecord } from './payroll-adjustment-records'
import { loadPayrollMigratedProof } from './payroll-migrated-proof'

export function createPayrollActualService(run: PayrollRun) {
  async function form(tx: TransactionDb, base: PayrollWritableContext, input: PayrollActualPaymentFormInput): Promise<PayrollActualPaymentFormRead> {
    assertPayrollActualTarget(input.target)
    if (input.draft !== undefined)
      assertPayrollActualDraft(input.draft)
    const all = (await loadPayrollAdjustmentRows(tx)).map(readPayrollAdjustmentRecord)
    const selected = input.target.adjustmentIds.map((id) => {
      const record = all.find(r => r.id === id)
      if (!record || record.status !== 'confirmed')
        throw payrollProblem('conflict', '实际补退只能关联已确认的原更正')
      return record
    })
    if (new Set(selected.map(r => r.rootAdjustmentId)).size !== selected.length)
      throw payrollProblem('relationship-mismatch', '同一更正余额不能以多个纠错身份重复处理')
    const originals = []
    for (const id of [...new Set(selected.map(r => r.originalStatementId))])
      originals.push((await loadPayrollAdjustmentOriginal(tx, id)).original)
    if (new Set(originals.map(o => hash([o.projectId, o.crewId, o.leaderWorkerId, o.formatFamily, o.formatFamily === 'A' ? o.book ?? { bookPurpose: 'ordinary', managementBookId: null } : null]))).size !== 1)
      throw payrollProblem('relationship-mismatch', '实际补退不能跨项目、跨主体或跨管理簿代收代退')
    const balances = []
    for (const id of input.target.adjustmentIds)
      balances.push(await loadPayrollAdjustmentBalance(tx, id))
    const draft = structuredClone(input.draft ?? { kind: 'refund' as const, occurredOn: '', amount: null, evidenceNote: '', allocations: [], applications: balances.map(b => ({ adjustmentId: b.adjustmentId, amount: null, balanceVersion: b.balanceVersion })) })
    const reasons: string[] = []
    const direction = draft.kind === 'refund' ? -1 : 1
    const amount = draft.amount
    if (amount === null || !wireCent(Math.abs(amount)) || amount * direction <= 0)
      reasons.push('请明确填写与补发或退款方向一致的实际金额，精确到分且不能为零')
    if (!wireDate(draft.occurredOn) || originals.some(o => draft.occurredOn < `${o.month}-01`))
      reasons.push('请填写不早于原工资月份的真实收付日期')
    if (!draft.evidenceNote.trim())
      reasons.push('请说明已经发生的收退款事实及人工核对依据')
    const members = new Set(originals.flatMap(o => o.memberWorkerIds))
    if (!draft.allocations.length || new Set(draft.allocations.map(a => a.workerId)).size !== draft.allocations.length || draft.allocations.some(a => !members.has(a.workerId) || a.amount === null || !wireCent(Math.abs(a.amount)) || a.amount * direction < 0) || amount === null || draft.allocations.reduce((sum, a) => sum + amountInCents(a.amount ?? 0), 0) !== amountInCents(amount))
      reasons.push('实际收退款须由不重复的原成员按同方向到分分配，合计等于本次实额')
    if (draft.applications.length !== balances.length || new Set(draft.applications.map(a => a.adjustmentId)).size !== balances.length || draft.applications.some(a => !input.target.adjustmentIds.includes(a.adjustmentId)) || amount === null || draft.applications.reduce((sum, a) => sum + amountInCents(a.amount ?? 0), 0) !== amountInCents(amount))
      reasons.push('各原更正的本次处理金额合计须等于本次实额，不能重复使用整笔金额')
    for (const application of draft.applications) {
      const balance = balances.find(b => b.adjustmentId === application.adjustmentId)
      const remaining = balance?.remainingDelta.value
      if (!balance || balance.balanceVersion !== application.balanceVersion || application.amount === null || !wireCent(Math.abs(application.amount)) || application.amount * direction <= 0 || remaining == null || remaining * direction <= 0 || Math.abs(application.amount) > Math.abs(remaining))
        reasons.push('采用的原更正余额已变化、方向不符或本次处理超过剩余，请重新核对')
    }
    const context = { ...base, readonly: !base.capabilities.includes('payroll:write'), sourceVersion: `${base.sourceVersion}+actual:${hash({ target: input.target, originals, balances, draft })}` }
    if (context.readonly)
      reasons.push('当前身份只能阅读工资收付')
    return { context, target: input.target, originals, balances, draft, eligibility: { canConfirmActual: !reasons.length, reasons: [...new Set(reasons)] } }
  }
  return {
    actualPaymentForm: (query: PayrollQuery, input: PayrollActualPaymentFormInput, sessionId?: string | null) => run(query, sessionId, async (tx, context) => {
      const read = await form(tx, context, input)
      if (query.projectId && read.originals.some(o => o.projectId !== query.projectId))
        throw payrollProblem('relationship-mismatch', '原补退工资不属于指定项目')
      return read
    }),
    actualPaymentDetail: (query: PayrollQuery, eventId: string, sessionId?: string | null): Promise<PayrollActualPaymentDetailRead> => run(query, sessionId, async (tx, context) => {
      const [row] = await tx.select<{ project_id: string, confirmed_snapshot_json: string }>('SELECT project_id,confirmed_snapshot_json FROM payroll_actual_events WHERE id=?', [eventId])
      if (!row)
        throw payrollProblem('not-found', '独立工资收付不存在')
      if (query.projectId && query.projectId !== row.project_id)
        throw payrollProblem('relationship-mismatch', '原工资收付不属于指定项目')
      const facts = await loadPayrollActualFacts(tx, { projectId: row.project_id })
      const fact = facts.rows.find(f => f.ref.kind === 'actual-event' && f.ref.eventId === eventId)
      if (!fact)
        throw payrollProblem('unavailable', '这条收付的原确认依据暂不能核实，保留原记录')
      return { context: { ...context, readonly: !context.capabilities.includes('payroll:write') }, fact, snapshot: (await loadPayrollMigratedProof(tx, row.project_id)).snapshots.get(eventId) ?? JSON.parse(row.confirmed_snapshot_json) }
    }),
    async executeActual(input: PayrollActualPaymentCommand, sessionId?: string | null): Promise<PayrollAdjustmentCommandResult> {
      assertPayrollActualCommand(input)
      const command = structuredClone(input)
      let absent = false
      try {
        return await run({ origin: command.origin }, sessionId, async (tx, context) => {
          if (context.workspaceId !== command.workspaceId || context.actorId !== command.actorId)
            throw payrollProblem('forbidden', '实际补退的工作区或经办人已变化')
          const fingerprint = hash(command)
          const [receipt] = await tx.select<{ fingerprint: string, actor_id: string, result_json: string }>('SELECT fingerprint,actor_id,result_json FROM payroll_command_receipts WHERE command_id=?', [command.commandId])
          if (receipt) {
            if (receipt.fingerprint !== fingerprint || receipt.actor_id !== command.actorId)
              throw payrollProblem('conflict', '同一实际补退提交编号不能换正文')
            return decodePayrollAdjustmentResult(JSON.parse(receipt.result_json), command)
          }
          absent = true
          const read = await form(tx, context, { target: command.target, draft: command.action.payment })
          if (command.projectId !== read.originals[0]!.projectId)
            throw payrollProblem('relationship-mismatch', '实际补退须保持原工资项目')
          if (read.context.sourceVersion !== command.sourceVersion)
            throw payrollProblem('stale-source', '原更正余额或实际处理依据已变化，请保留输入重新核对')
          if (!read.eligibility.canConfirmActual)
            throw payrollProblem('validation-failed', read.eligibility.reasons[0]!)
          const actualEventId = generateId('payroll-actual')
          const applicationIds = read.draft.applications.map(() => generateId('payroll-application'))
          const snapshot: PayrollActualPaymentSnapshot = { schemaVersion: 1, id: actualEventId, commandId: command.commandId, projectId: command.projectId, originals: read.originals, draft: read.draft, applicationIds, confirmedBy: context.actorId, confirmedAt: new Date().toISOString() }
          const logIds = [await payrollWriteRow(tx, 'payroll_actual_events', actualEventId, { project_id: command.projectId, kind: read.draft.kind, occurred_on: read.draft.occurredOn, signed_amount_fen: amountInCents(read.draft.amount!), proof_json: payrollCanonical({ evidenceNote: read.draft.evidenceNote }), confirmed_snapshot_json: payrollCanonical(snapshot), confirmed_by: context.actorId, confirmed_at: snapshot.confirmedAt }, context.actorId)]
          for (const allocation of read.draft.allocations) {
            const member = read.originals.flatMap(o => o.members).find(m => m.workerId === allocation.workerId)!
            logIds.push(await payrollWriteRow(tx, 'payroll_actual_allocations', generateId('payroll-actual-allocation'), { event_id: actualEventId, worker_id: allocation.workerId, signed_amount_fen: amountInCents(allocation.amount!), proof_json: payrollCanonical(member) }, context.actorId))
          }
          for (const [index, application] of read.draft.applications.entries()) {
            const balance = read.balances.find(b => b.adjustmentId === application.adjustmentId)!
            logIds.push(await payrollWriteRow(tx, 'payroll_adjustment_applications', applicationIds[index]!, { adjustment_id: application.adjustmentId, root_adjustment_id: balance.rootAdjustmentId, kind: 'actual-payment', signed_applied_fen: amountInCents(application.amount!), actual_event_id: actualEventId, released_statement_id: null, balance_version: application.balanceVersion, proof_json: payrollCanonical({ commandId: command.commandId, before: balance }) }, context.actorId))
          }
          await advancePayrollRevision(tx)
          const result: PayrollAdjustmentCommandResult = { commandId: command.commandId, projectId: command.projectId, originalStatementId: read.originals[0]!.statementId, adjustmentId: null, actualEventId, applicationIds, outcome: 'confirmed', sourceVersion: `payroll:${await payrollRevision(tx)}`, logIds }
          await tx.execute('INSERT INTO payroll_command_receipts(command_id,actor_id,project_id,statement_id,action,fingerprint,result_json,command_json) VALUES(?,?,?,?,?,?,?,?)', [command.commandId, context.actorId, command.projectId, read.originals[0]!.statementId, command.action.kind, fingerprint, payrollCanonical(result), payrollCanonical(command)])
          return result
        }, true)
      }
      catch (cause) {
        if (absent && cause instanceof ProjectRepositoryProblem)
          Object.assign(cause.problem, { commandId: command.commandId, commandOutcome: 'not-applied' })
        throw cause
      }
    },
  }
}
