import type { PayrollNumberingResult, PayrollNumberingSettings, PayrollOfficialIssue } from '../../app/lib/payroll/central-numbering-contract'
import { createHash } from 'node:crypto'
import { payrollCanonical } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { decodePayrollNumberingResult, isPayrollNumberingSettings, isPayrollOfficialIssue, parsePayrollNumberingCommand } from '../../app/lib/payroll/central-numbering-codec'

export const payrollNumberingHash = (value: unknown) => createHash('sha256').update(payrollCanonical(value)).digest('hex')
export function numberingSettings(row: Record<string, unknown>): PayrollNumberingSettings {
  const value = { id: row.id, projectId: row.project_id, firstNumber: row.first_number, nextNumber: row.next_number, evidenceNote: row.evidence_note, initializedAt: row.initialized_at, operatorId: row.operator_id }
  if (!isPayrollNumberingSettings(value))
    throw payrollProblem('unavailable', '项目编号原记录损坏，不能猜号或重置')
  return value
}
export function numberingIssue(row: Record<string, unknown>): PayrollOfficialIssue {
  const value = { id: row.id, projectId: row.project_id, statementId: row.statement_id, formatFamily: row.format_family, number: row.official_number, documentHash: row.document_hash, issuedAt: row.issued_at, operatorId: row.operator_id, commandId: row.command_id }
  if (!isPayrollOfficialIssue(value))
    throw payrollProblem('unavailable', '正式出具原记录损坏，不能重新占号')
  return value
}
export function numberingReceipt(row: Record<string, unknown>) {
  try {
    const command = parsePayrollNumberingCommand(JSON.parse(String(row.command_json)))
    const result: PayrollNumberingResult = decodePayrollNumberingResult(JSON.parse(String(row.result_json)), command)
    if (row.command_id !== command.commandId || row.actor_id !== command.actorId || row.project_id !== command.projectId || row.statement_id !== command.statementId
      || row.config_scope_json !== null || row.action !== `numbering-${command.action.kind}` || row.fingerprint !== payrollNumberingHash(command)) {
      throw new Error('scope')
    }
    return { command, result }
  }
  catch { throw payrollProblem('unavailable', '原编号回执或身份损坏，请核对原提交，不能重新占号') }
}

export function payrollNumberingReceiptReferences(row: Record<string, unknown>): Set<string> | null {
  if (!['numbering-initialize', 'numbering-issue'].includes(String(row.action)))
    return null
  const { command, result } = numberingReceipt(row)
  const refs = new Set<string>()
  const add = (table: string, id: string | null) => {
    if (id)
      refs.add(JSON.stringify([table, id]))
  }
  add('projects', command.projectId)
  add('wage_statements', command.statementId)
  add('payroll_numbering_settings', result.settings.id)
  if (result.issue) {
    add('payroll_official_issues', result.issue.id)
    add('wage_statements', result.issue.statementId)
    add('payroll_command_receipts', result.issue.commandId)
  }
  return refs
}
