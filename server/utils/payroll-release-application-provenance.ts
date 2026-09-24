import type { TransactionDb } from '../../app/lib/db/coordinator'
import { payrollCanonical } from '../../app/lib/payroll/central-command-shared'
import { wireId, wireObject } from '../../app/lib/payroll/central-payroll-wire'
import { isPayrollReleaseApplications } from '../../app/lib/payroll/central-release-adjustment-wire'
import { amountInCents } from '../../app/lib/payroll/statements'
import { payrollAdjustmentHash as hash } from './payroll-adjustment-facts'
import { loadPayrollMigratedProof } from './payroll-migrated-proof'

/** 调用者另证原 released 金额；此处只核对其独立余额应用，不再生成一笔现金。 */
export async function loadPayrollReleasedApplicationIds(tx: TransactionDb, statementId: string): Promise<string[]> {
  const imported = (await loadPayrollMigratedProof(tx)).releasedApplications.get(statementId)
  if (imported)
    return imported
  const rows = await tx.select<{ id: string, adjustment_id: string, root_adjustment_id: string, kind: string, signed_applied_fen: number, balance_version: string, proof_json: string, actual_event_id: string | null }>('SELECT * FROM payroll_adjustment_applications WHERE released_statement_id=? ORDER BY id', [statementId])
  if (!rows.length)
    return []
  const receipts = await tx.select<{ command_id: string, actor_id: string, project_id: string, action: string, command_json: string, fingerprint: string, result_json: string }>('SELECT * FROM payroll_command_receipts WHERE statement_id=? AND action IN (\'release-a\',\'release-c1\',\'release-c2\')', [statementId])
  for (const receipt of receipts) {
    try {
      const command: unknown = JSON.parse(receipt.command_json)
      const result: unknown = JSON.parse(receipt.result_json)
      if (!wireObject(command) || !wireObject(command.action) || !wireObject(command.action.release) || !isPayrollReleaseApplications(command.action.release.adjustmentApplications) || command.statementId !== statementId || command.commandId !== receipt.command_id || command.actorId !== receipt.actor_id || command.projectId !== receipt.project_id || command.action.kind !== receipt.action || hash(command) !== receipt.fingerprint || payrollCanonical(command) !== receipt.command_json || !wireObject(result) || result.commandId !== receipt.command_id || result.statementId !== statementId || result.projectId !== receipt.project_id || result.outcome !== 'released' || !Array.isArray(result.adjustmentApplicationIds) || !result.adjustmentApplicationIds.every(wireId) || hash([...result.adjustmentApplicationIds].sort()) !== hash(rows.map(r => r.id).sort()))
        continue
      const submitted = command.action.release.adjustmentApplications
      if (submitted.length !== rows.length)
        continue
      let valid = true
      for (const row of rows) {
        const [original] = await tx.select<{ root_adjustment_id: string, original_statement_id: string, project_id: string }>('SELECT root_adjustment_id,original_statement_id,project_id FROM payroll_adjustments WHERE id=?', [row.adjustment_id])
        const application = submitted.find(a => a.adjustmentId === row.adjustment_id)
        if (!original || !application || row.kind !== 'later-release' || row.actual_event_id !== null || original.project_id !== receipt.project_id || original.root_adjustment_id !== row.root_adjustment_id || row.signed_applied_fen !== amountInCents(application.amount) || row.balance_version !== application.balanceVersion || hash(JSON.parse(row.proof_json)) !== hash({ commandId: command.commandId, ...application, rootAdjustmentId: row.root_adjustment_id, originalStatementId: original.original_statement_id }))
          valid = false
      }
      if (valid)
        return rows.map(r => r.id)
    }
    catch { /* 损坏的应用没有结清余额的资格。 */ }
  }
  return []
}
