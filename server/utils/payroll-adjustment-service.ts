import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollActualLedgerRead, PayrollActualScope } from '../../app/lib/payroll/central-actual-contract'
import type { PayrollAdjustmentCommandResult, PayrollAdjustmentConfirmedSnapshot, PayrollAdjustmentDetailRead, PayrollAdjustmentFormInput, PayrollAdjustmentFormRead, PayrollAdjustmentHistoryRead, PayrollCorrectionCommand } from '../../app/lib/payroll/central-adjustment-contract'
import type { PayrollQuery, PayrollWritableContext } from '../../app/lib/payroll/central-contract'
import type { PayrollRun } from './payroll-service'
import { payrollAAmount } from '../../app/lib/payroll/central-a-calculation'
import { payrollCorrectionAmount } from '../../app/lib/payroll/central-adjustment-calculation'
import { decodePayrollAdjustmentResult } from '../../app/lib/payroll/central-adjustment-codec'
import { assertPayrollAdjustmentCommand, assertPayrollAdjustmentDraft, assertPayrollAdjustmentTarget, payrollCorrectionReasons } from '../../app/lib/payroll/central-adjustment-validation'
import { parsePayrollActualScope } from '../../app/lib/payroll/central-adjustment-wire'
import { payrollCanonical, payrollWriteRow } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { advancePayrollRevision, payrollRevision } from '../../app/lib/payroll/central-schema'
import { amountInCents } from '../../app/lib/payroll/statements'
import { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { generateId } from '../../app/lib/util/id'
import { loadPayrollActualFacts } from './payroll-actual-facts'
import { payrollAdjustmentChainHeads } from './payroll-adjustment-chain'
import { payrollAdjustmentHash as hash, payrollKnownAmount as known, loadPayrollAdjustmentOriginal } from './payroll-adjustment-facts'
import { loadPayrollAdjustmentApplicationHistory } from './payroll-adjustment-history'
import { loadPayrollAdjustmentBalance, readPayrollAdjustmentRecord as record, loadPayrollAdjustmentRows as records } from './payroll-adjustment-records'

export function createPayrollAdjustmentService(run: PayrollRun) {
  async function form(tx: TransactionDb, base: PayrollWritableContext, input: PayrollAdjustmentFormInput): Promise<PayrollAdjustmentFormRead> {
    assertPayrollAdjustmentTarget(input.target)
    if (input.draft !== undefined)
      assertPayrollAdjustmentDraft(input.draft)
    const all = await records(tx)
    const row = input.target.adjustmentId === null ? null : all.find(r => r.id === input.target.adjustmentId)
    if (input.target.adjustmentId !== null && !row)
      throw payrollProblem('not-found', '独立更正不存在')
    const originalStatementId = row?.original_statement_id ?? (input.target.adjustmentId === null ? input.target.originalStatementId : '')
    const { original, basis } = await loadPayrollAdjustmentOriginal(tx, originalStatementId)
    const confirmed = all.filter(r => r.original_statement_id === originalStatementId && r.status === 'confirmed').map(record)
    const previous = row?.status === 'confirmed'
      ? confirmed.find(r => r.id === row.corrects_adjustment_id)
      : payrollAdjustmentChainHeads(confirmed)[0]
    const before = previous?.draft.basis ?? basis
    const stored = row ? record(row) : null
    const draft = structuredClone(row?.status === 'confirmed' ? stored!.draft : input.draft ?? stored?.draft ?? { reason: '', evidenceNote: '', correctsAdjustmentId: previous?.id ?? null, basis: before })
    const reasons = draft.basis ? payrollCorrectionReasons(draft.basis, basis) : ['请填写独立更正依据']
    if (!draft.reason.trim())
      reasons.push('请说明原核算的错误及本次更正原因')
    if (!draft.evidenceNote.trim())
      reasons.push('请记录本次具名人工核对采用的具体依据')
    if (draft.correctsAdjustmentId !== (previous?.id ?? null))
      reasons.push('前序更正已变化，请核对最新有效依据')
    const beforeAmount = payrollCorrectionAmount(before)
    const afterAmount = draft.basis ? payrollCorrectionAmount(draft.basis, reasons) : payrollAAmount([null], reasons)
    const delta = beforeAmount.value !== null && afterAmount.value !== null ? known((amountInCents(afterAmount.value) - amountInCents(beforeAmount.value)) / 100) : payrollAAmount([null], reasons)
    const proofRefs = [{ kind: 'frozen-source' as const, id: original.statementId, sourceFingerprint: original.provenanceVersion }]
    const context = { ...base, readonly: !base.capabilities.includes('payroll:write'), sourceVersion: `${base.sourceVersion}+adjustments:${hash({ original, rows: all.filter(r => r.original_statement_id === originalStatementId), target: input.target, draft })}` }
    const writable = !context.readonly && row?.status !== 'confirmed'
    return { context, target: input.target, original, status: row?.status ?? 'new', draft, preview: stored?.snapshot?.preview ?? { before, after: draft.basis, beforeAmount, afterAmount, delta, proofRefs, reasons }, eligibility: { canSaveDraft: writable, canConfirmAdjustment: writable && !!row && !reasons.length && delta.value !== null && hash(before) !== hash(draft.basis), reasons: [...reasons, ...(context.readonly ? ['当前身份只能阅读工资更正'] : []), ...(row?.status === 'confirmed' ? ['已确认更正只能追加有引用的后续纠错'] : [])] } }
  }
  return {
    adjustmentHistory: (query: PayrollQuery, originalStatementId: string, sessionId?: string | null): Promise<PayrollAdjustmentHistoryRead> => run(query, sessionId, async (tx, context) => {
      const { original } = await loadPayrollAdjustmentOriginal(tx, originalStatementId)
      if (query.projectId && query.projectId !== original.projectId)
        throw payrollProblem('relationship-mismatch', '原工资更正历史不属于指定项目')
      const all = (await records(tx, originalStatementId)).map(record)
      const adjustments = []
      for (const adjustment of all) adjustments.push({ adjustment, balance: await loadPayrollAdjustmentBalance(tx, adjustment.id) })
      return { context: { ...context, readonly: !context.capabilities.includes('payroll:write') }, original, adjustments, applications: await loadPayrollAdjustmentApplicationHistory(tx, original.projectId, [...new Set(all.map(a => a.rootAdjustmentId))]) }
    }),
    adjustmentForm: (query: PayrollQuery, input: PayrollAdjustmentFormInput, sessionId?: string | null) => run(query, sessionId, async (tx, context) => {
      const read = await form(tx, context, input)
      if (query.projectId && query.projectId !== read.original.projectId)
        throw payrollProblem('relationship-mismatch', '原更正不属于指定项目')
      return read
    }),
    adjustmentDetail: (query: PayrollQuery, adjustmentId: string, sessionId?: string | null): Promise<PayrollAdjustmentDetailRead> => run(query, sessionId, async (tx, context) => {
      const read = await form(tx, context, { target: { adjustmentId } })
      if (query.projectId && query.projectId !== read.original.projectId)
        throw payrollProblem('relationship-mismatch', '原更正不属于指定项目')
      const all = (await records(tx, read.original.statementId)).map(record)
      const adjustment = all.find(r => r.id === adjustmentId)!
      return { context: read.context, original: read.original, adjustment, balance: await loadPayrollAdjustmentBalance(tx, adjustmentId), applications: await loadPayrollAdjustmentApplicationHistory(tx, read.original.projectId, [adjustment.rootAdjustmentId]) }
    }),
    actualLedger: (query: PayrollQuery, scope: PayrollActualScope, sessionId?: string | null): Promise<PayrollActualLedgerRead> => run(query, sessionId, async (tx, context) => {
      parsePayrollActualScope(scope)
      if (query.projectId && query.projectId !== scope.projectId)
        throw payrollProblem('relationship-mismatch', '工资收付范围与指定项目不一致')
      return { context: { ...context, readonly: !context.capabilities.includes('payroll:write') }, scope, ...await loadPayrollActualFacts(tx, scope) }
    }),
    async executeAdjustment(input: PayrollCorrectionCommand, sessionId?: string | null): Promise<PayrollAdjustmentCommandResult> {
      assertPayrollAdjustmentCommand(input)
      const command = structuredClone(input)
      let absent = false
      try {
        return await run({ origin: command.origin }, sessionId, async (tx, context) => {
          if (command.actorId !== context.actorId || command.workspaceId !== context.workspaceId)
            throw payrollProblem('forbidden', '更正提交的工作区或经办人已变化')
          const fingerprint = hash(command)
          const [receipt] = await tx.select<{ fingerprint: string, actor_id: string, result_json: string }>('SELECT fingerprint,actor_id,result_json FROM payroll_command_receipts WHERE command_id=?', [command.commandId])
          if (receipt) {
            if (receipt.fingerprint !== fingerprint || receipt.actor_id !== command.actorId)
              throw payrollProblem('conflict', '同一更正提交编号不能换用另一份正文')
            return decodePayrollAdjustmentResult(JSON.parse(receipt.result_json), command)
          }
          absent = true
          const read = await form(tx, context, { target: command.target, ...(command.action.kind === 'save-adjustment-draft' ? { draft: command.action.draft } : {}) })
          if (read.original.projectId !== command.projectId)
            throw payrollProblem('relationship-mismatch', '更正须保留原工资项目')
          if (read.context.sourceVersion !== command.sourceVersion)
            throw payrollProblem('stale-source', '原工资、更正依据或前序处理已变化，请保留输入重新核对')
          const adjustmentId = command.target.adjustmentId ?? generateId('payroll-adjustment')
          const previous = read.draft.correctsAdjustmentId ? (await records(tx, read.original.statementId)).find(r => r.id === read.draft.correctsAdjustmentId) : null
          const rootAdjustmentId = previous?.root_adjustment_id ?? adjustmentId
          const now = new Date().toISOString()
          let snapshot: PayrollAdjustmentConfirmedSnapshot | null = null
          if (command.action.kind === 'confirm-adjustment') {
            if (!read.eligibility.canConfirmAdjustment)
              throw payrollProblem('validation-failed', read.eligibility.reasons[0] ?? '更正依据未变化或尚未核对完整')
            snapshot = { schemaVersion: 1, id: adjustmentId, rootAdjustmentId, correctsAdjustmentId: read.draft.correctsAdjustmentId, original: read.original, reason: read.draft.reason, evidenceNote: read.draft.evidenceNote, preview: read.preview, confirmedBy: context.actorId, confirmedAt: now, commandId: command.commandId }
          }
          else if (!read.eligibility.canSaveDraft) {
            throw payrollProblem('conflict', '已确认更正不得编辑或覆盖')
          }
          const logId = await payrollWriteRow(tx, 'payroll_adjustments', adjustmentId, { root_adjustment_id: rootAdjustmentId, corrects_adjustment_id: read.draft.correctsAdjustmentId, original_statement_id: read.original.statementId, project_id: command.projectId, format_family: read.original.formatFamily, status: snapshot ? 'confirmed' : 'draft', reason: read.draft.reason, evidence_note: read.draft.evidenceNote, basis_json: payrollCanonical(read.draft.basis), signed_delta_fen: snapshot ? amountInCents(read.preview.delta.value!) : null, confirmed_snapshot_json: snapshot ? payrollCanonical(snapshot) : null, ...(read.status === 'new' ? { created_by: context.actorId, created_at: now } : {}), ...(snapshot ? { confirmed_by: context.actorId, confirmed_at: now } : {}), updated_at: now }, context.actorId)
          await advancePayrollRevision(tx)
          const result: PayrollAdjustmentCommandResult = { commandId: command.commandId, projectId: command.projectId, originalStatementId: read.original.statementId, adjustmentId, actualEventId: null, applicationIds: [], outcome: snapshot ? 'confirmed' : 'saved', sourceVersion: `payroll:${await payrollRevision(tx)}`, logIds: [logId] }
          await tx.execute('INSERT INTO payroll_command_receipts(command_id,actor_id,project_id,statement_id,action,fingerprint,result_json,command_json) VALUES(?,?,?,?,?,?,?,?)', [command.commandId, context.actorId, command.projectId, read.original.statementId, command.action.kind, fingerprint, payrollCanonical(result), payrollCanonical(command)])
          return result
        }, true, command)
      }
      catch (cause) {
        if (absent && cause instanceof ProjectRepositoryProblem)
          Object.assign(cause.problem, { commandId: command.commandId, commandOutcome: 'not-applied' })
        throw cause
      }
    },
  }
}
