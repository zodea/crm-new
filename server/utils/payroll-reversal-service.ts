import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollActualReversalFormInput, PayrollActualReversalFormRead, PayrollActualReversalSnapshot, PayrollReversalApplication } from '../../app/lib/payroll/central-actual-contract'
import type { PayrollActualReversalCommand, PayrollAdjustmentCommandResult } from '../../app/lib/payroll/central-adjustment-contract'
import type { PayrollQuery, PayrollWritableContext } from '../../app/lib/payroll/central-contract'
import type { PayrollRun } from './payroll-service'
import { payrollAAmount } from '../../app/lib/payroll/central-a-calculation'
import { decodePayrollAdjustmentResult } from '../../app/lib/payroll/central-adjustment-codec'
import { initializePayrollAdjustmentSchema } from '../../app/lib/payroll/central-adjustment-schema'
import { payrollCanonical, payrollWriteRow } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { wireDate } from '../../app/lib/payroll/central-payroll-wire'
import { assertPayrollReversalCommand, assertPayrollReversalDraft, assertPayrollReversalTarget } from '../../app/lib/payroll/central-reversal-validation'
import { advancePayrollRevision, payrollRevision } from '../../app/lib/payroll/central-schema'
import { amountInCents } from '../../app/lib/payroll/statements'
import { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { generateId } from '../../app/lib/util/id'
import { loadPayrollActualFacts } from './payroll-actual-facts'
import { payrollAdjustmentHash as hash, payrollKnownAmount as known, loadPayrollAdjustmentOriginal } from './payroll-adjustment-facts'
import { loadPayrollAdjustmentBalance } from './payroll-adjustment-records'
import { loadPayrollReleasedApplicationIds } from './payroll-release-application-provenance'

export function createPayrollReversalService(run: PayrollRun) {
  async function form(tx: TransactionDb, base: PayrollWritableContext, input: PayrollActualReversalFormInput): Promise<PayrollActualReversalFormRead> {
    assertPayrollReversalTarget(input.target)
    if (input.draft !== undefined)
      assertPayrollReversalDraft(input.draft)
    await initializePayrollAdjustmentSchema(tx)
    const reference = input.target.original
    const id = reference.kind === 'released-statement' ? reference.statementId : reference.eventId
    const table = reference.kind === 'released-statement' ? 'wage_statements' : 'payroll_actual_events'
    const [head] = await tx.select<{ project_id: string }>(`SELECT project_id FROM ${table} WHERE id=?`, [id])
    if (!head)
      throw payrollProblem('not-found', '被核查的原工资收付不存在')
    const facts = await loadPayrollActualFacts(tx, { projectId: head.project_id })
    const originalFact = facts.rows.find(f => hash(f.ref) === hash(reference))
    if (!originalFact)
      throw payrollProblem('unavailable', '原收付的确认与金额依据暂不能核实')
    const originals = []
    for (const statementId of originalFact.originalStatementIds)
      originals.push((await loadPayrollAdjustmentOriginal(tx, statementId)).original)
    const alreadyReversedBy = (await tx.select<{ id: string }>('SELECT id FROM payroll_actual_events WHERE kind=\'recording-reversal\' AND reverses_kind=? AND reverses_id=?', [reference.kind, id])).map(r => r.id)
    const draft = structuredClone(input.draft ?? { confirmedNotOccurred: false, confirmedOn: '', evidenceNote: '' })
    const reasons: string[] = []
    if (originalFact.qualification !== 'proven' || originalFact.signedAmount.value === null || originalFact.signedAmount.value === 0 || originalFact.allocationState !== 'complete')
      reasons.push('原收付及个人分配必须完整可证，未知记录不能自行冲成零')
    if (alreadyReversedBy.length)
      reasons.push('这条原记录已有独立错记冲销；如冲销也有误，请引用该冲销追加纠错')
    if (!draft.confirmedNotOccurred)
      reasons.push(originalFact.kind === 'recording-reversal' ? '须明确核实这次冲销所称的事实不成立，再引用原冲销追加纠错' : '须明确核对原记录所声称的事实未真实发生；实际已付款后退回应登记真实退款')
    if (!wireDate(draft.confirmedOn) || (originalFact.occurredOn && draft.confirmedOn < originalFact.occurredOn))
      reasons.push('请填写不早于原记录日期的核查日期')
    if (!draft.evidenceNote.trim())
      reasons.push(originalFact.kind === 'recording-reversal' ? '请记录纠正原冲销的具名核查依据' : '请记录为什么确认这笔原收付未真实发生的具名核查依据')
    const originalApplications = await tx.select<{ id: string, adjustment_id: string, root_adjustment_id: string, signed_applied_fen: number }>(`SELECT * FROM payroll_adjustment_applications WHERE ${reference.kind === 'released-statement' ? 'released_statement_id' : 'actual_event_id'}=? ORDER BY id`, [id])
    const applicationIds = reference.kind === 'released-statement' ? await loadPayrollReleasedApplicationIds(tx, id) : originalFact.applicationIds
    const applications: PayrollReversalApplication[] = []
    for (const application of originalApplications) {
      const balance = await loadPayrollAdjustmentBalance(tx, application.adjustment_id)
      if (!applicationIds.includes(application.id) || balance.remainingDelta.value === null || balance.rootAdjustmentId !== application.root_adjustment_id)
        reasons.push('原收付的余额处理引用或当前余额暂不能核实')
      applications.push({ originalApplicationId: application.id, adjustmentId: application.adjustment_id, rootAdjustmentId: application.root_adjustment_id, amount: -application.signed_applied_fen / 100, balanceVersion: balance.balanceVersion })
    }
    const context = { ...base, readonly: !base.capabilities.includes('payroll:write'), sourceVersion: `${base.sourceVersion}+reversal:${hash({ target: input.target, originalFact, originals, applications, alreadyReversedBy, draft })}` }
    if (context.readonly)
      reasons.push('当前身份只能阅读工资错记核查')
    return { context, target: input.target, originalFact, originals, draft, reversalAmount: originalFact.signedAmount.value === null ? payrollAAmount([null], reasons) : known(-originalFact.signedAmount.value), applications, alreadyReversedBy, eligibility: { canConfirmReversal: !reasons.length, reasons: [...new Set(reasons)] } }
  }
  return {
    actualReversalForm: (query: PayrollQuery, input: PayrollActualReversalFormInput, sessionId?: string | null) => run(query, sessionId, async (tx, context) => {
      const read = await form(tx, context, input)
      if (query.projectId && query.projectId !== read.originalFact.projectId)
        throw payrollProblem('relationship-mismatch', '错记原收付不属于指定项目')
      return read
    }),
    async executeReversal(input: PayrollActualReversalCommand, sessionId?: string | null): Promise<PayrollAdjustmentCommandResult> {
      assertPayrollReversalCommand(input)
      const command = structuredClone(input)
      let absent = false
      try {
        return await run({ origin: command.origin }, sessionId, async (tx, context) => {
          if (context.actorId !== command.actorId || context.workspaceId !== command.workspaceId)
            throw payrollProblem('forbidden', '错记核查的工作区或经办人已变化')
          const fingerprint = hash(command)
          const [receipt] = await tx.select<{ fingerprint: string, actor_id: string, result_json: string }>('SELECT fingerprint,actor_id,result_json FROM payroll_command_receipts WHERE command_id=?', [command.commandId])
          if (receipt) {
            if (receipt.fingerprint !== fingerprint || receipt.actor_id !== command.actorId)
              throw payrollProblem('conflict', '原错记提交编号不能更换正文')
            return decodePayrollAdjustmentResult(JSON.parse(receipt.result_json), command)
          }
          absent = true
          const read = await form(tx, context, { target: command.target, draft: command.action.reversal })
          if (read.originalFact.projectId !== command.projectId)
            throw payrollProblem('relationship-mismatch', '错记冲销不能转移原收付项目')
          if (read.context.sourceVersion !== command.sourceVersion)
            throw payrollProblem('stale-source', '原收付、处理余额或核查依据已变化，请保留输入重新核对')
          if (!read.eligibility.canConfirmReversal)
            throw payrollProblem('validation-failed', read.eligibility.reasons[0]!)
          const actualEventId = generateId('payroll-reversal')
          const applicationIds = read.applications.map(() => generateId('payroll-application'))
          const snapshot: PayrollActualReversalSnapshot = { schemaVersion: 1, kind: 'recording-reversal', id: actualEventId, commandId: command.commandId, projectId: command.projectId, originalFact: read.originalFact, originals: read.originals, draft: read.draft, applications: read.applications, applicationIds, confirmedBy: context.actorId, confirmedAt: new Date().toISOString() }
          const reference = command.target.original
          const logIds = [await payrollWriteRow(tx, 'payroll_actual_events', actualEventId, { project_id: command.projectId, kind: 'recording-reversal', occurred_on: read.draft.confirmedOn, signed_amount_fen: amountInCents(read.reversalAmount.value!), reverses_kind: reference.kind, reverses_id: reference.kind === 'released-statement' ? reference.statementId : reference.eventId, proof_json: payrollCanonical({ original: reference, ...read.draft }), confirmed_snapshot_json: payrollCanonical(snapshot), confirmed_by: context.actorId, confirmed_at: snapshot.confirmedAt }, context.actorId)]
          for (const allocation of read.originalFact.allocations)
            logIds.push(await payrollWriteRow(tx, 'payroll_actual_allocations', generateId('payroll-actual-allocation'), { event_id: actualEventId, worker_id: allocation.workerId, signed_amount_fen: -amountInCents(allocation.amount!), proof_json: payrollCanonical({ workerId: allocation.workerId, workerName: allocation.workerName, crewId: allocation.crewId }) }, context.actorId))
          for (const [index, application] of read.applications.entries())
            logIds.push(await payrollWriteRow(tx, 'payroll_adjustment_applications', applicationIds[index]!, { adjustment_id: application.adjustmentId, root_adjustment_id: application.rootAdjustmentId, kind: 'recording-reversal', signed_applied_fen: amountInCents(application.amount), actual_event_id: actualEventId, released_statement_id: null, balance_version: application.balanceVersion, proof_json: payrollCanonical({ commandId: command.commandId, ...application }) }, context.actorId))
          await advancePayrollRevision(tx)
          const result: PayrollAdjustmentCommandResult = { commandId: command.commandId, projectId: command.projectId, originalStatementId: read.originals[0]!.statementId, adjustmentId: null, actualEventId, applicationIds, outcome: 'confirmed', sourceVersion: `payroll:${await payrollRevision(tx)}`, logIds }
          await tx.execute('INSERT INTO payroll_command_receipts(command_id,actor_id,project_id,statement_id,action,fingerprint,result_json,command_json) VALUES(?,?,?,?,?,?,?,?)', [command.commandId, context.actorId, command.projectId, result.originalStatementId, command.action.kind, fingerprint, payrollCanonical(result), payrollCanonical(command)])
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
