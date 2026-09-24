import type { PayrollAFeeConfigRead, PayrollAFeeConfigScope, PayrollAFeesCommand, PayrollAFeesCommandResult } from './central-a-fees-contract'
import type { PayrollQuery } from './central-contract'
import { payrollACanonical } from './central-a-calculation'
import { decodePayrollAWire, encodePayrollAWire } from './central-a-codec'
import { isPayrollAFeeConfigRead } from './central-a-fees-read-validation'
import { feeArray, feeExact, feeId, feeMonth, feeNullableId, feeNullableNumber, feeObject, feeText, isPayrollABook, isPayrollAFeeDraft, isPayrollAManagementScope, isPayrollANegativeValues } from './central-a-fees-validation'
import { payrollProblem } from './central-contract'

export const encodePayrollAFeesWire = encodePayrollAWire
function fail(): never {
  throw payrollProblem('validation-failed', '工资费用提交或读取内容无效')
}
export function parsePayrollAFeeConfigScope(value: unknown): PayrollAFeeConfigScope {
  feeExact(value, ['projectId', 'month', 'crewId', 'leaderWorkerId', 'book'])
  if (!feeId(value.projectId) || !feeMonth(value.month) || !feeNullableId(value.crewId) || !feeNullableId(value.leaderWorkerId) || !isPayrollABook(value.book))
    fail()
  return value as unknown as PayrollAFeeConfigScope
}
export function parsePayrollAFeesCommand(raw: unknown): PayrollAFeesCommand {
  const v = decodePayrollAWire(raw)
  feeExact(v, ['commandId', 'workspaceId', 'actorId', 'origin', 'requiredCapability', 'sourceVersion', 'projectId', 'statementId', 'draftKey', 'configScope', 'book', 'action'])
  if (!['commandId', 'workspaceId', 'actorId', 'projectId'].every(k => feeId(v[k])) || v.origin !== 'real' || v.requiredCapability !== 'payroll:write' || !feeText(v.sourceVersion) || !feeNullableId(v.statementId) || !feeNullableId(v.draftKey) || !isPayrollABook(v.book))
    fail()
  if (v.configScope !== null)
    parsePayrollAFeeConfigScope(v.configScope)
  const a = v.action
  if (!feeObject(a) || !feeText(a.baseVersion))
    fail()
  if (a.kind === 'save-a-fees') {
    feeExact(a, ['kind', 'baseVersion', 'fees', 'remove'])
    if (!feeArray(a.fees, (f) => {
      feeExact(f, ['bookPurpose', 'managementBookId', 'kind', 'feeId', 'baseRevisionId', 'name', 'enabled', 'unitPrice', 'unit', 'basis', 'effectiveMonth', 'adoptedDefault'])
      return isPayrollAFeeDraft(f)
    }) || !feeArray(a.remove, (r) => {
      feeExact(r, ['feeId', 'baseRevisionId'])
      return feeId(r.feeId) && feeId(r.baseRevisionId)
    })) {
      fail()
    }
  }
  else if (a.kind === 'save-a-management-book') {
    feeExact(a, ['kind', 'baseVersion', 'management'])
    const m = a.management
    feeExact(m, ['managementBookId', 'baseRevisionId', 'managerWorkerId', 'effectiveMonth', 'managementMode', 'scope', 'initialPayRatio', 'evidenceNote'])
    if (!feeNullableId(m.managementBookId) || !feeNullableId(m.baseRevisionId) || !feeNullableId(m.managerWorkerId) || !feeMonth(m.effectiveMonth) || !['crew-managed', 'company-managed'].includes(String(m.managementMode)) || !isPayrollAManagementScope(m.scope) || !feeNullableNumber(m.initialPayRatio) || !feeText(m.evidenceNote))
      fail()
  }
  else if (a.kind === 'start-a-management-draft') {
    feeExact(a, ['kind', 'baseVersion', 'managementBookId', 'managementRevisionId', 'month', 'periodKind'])
    if (!feeId(a.managementBookId) || !feeId(a.managementRevisionId) || !feeMonth(a.month) || !['monthly', 'settlement', 'retention'].includes(String(a.periodKind)))
      fail()
  }
  else if (a.kind === 'save-a-negative-lines') {
    feeExact(a, ['kind', 'baseVersion', 'lines', 'remove'])
    if (!feeArray(a.lines, (n) => {
      feeExact(n, ['lineId', 'baseRevisionId', 'label', 'quantity', 'unit', 'unitPrice', 'scope', 'reason', 'evidenceNote', 'actualRef'])
      return isPayrollANegativeValues(n) && feeNullableId(n.lineId) && feeNullableId(n.baseRevisionId)
    }) || !feeArray(a.remove, (r) => {
      feeExact(r, ['lineId', 'baseRevisionId'])
      return feeId(r.lineId) && feeId(r.baseRevisionId)
    })) {
      fail()
    }
  }
  else {
    fail()
  }
  return v as unknown as PayrollAFeesCommand
}
export function decodePayrollAFeeConfigRead(raw: unknown, query: PayrollQuery, scope: PayrollAFeeConfigScope): PayrollAFeeConfigRead {
  const v = decodePayrollAWire(raw)
  if (!isPayrollAFeeConfigRead(v, query.origin) || payrollACanonical(parsePayrollAFeeConfigScope(v.scope)) !== payrollACanonical(scope))
    fail()
  return v as unknown as PayrollAFeeConfigRead
}
export function decodePayrollAFeesResult(v: unknown, command: PayrollAFeesCommand): PayrollAFeesCommandResult {
  feeExact(v, ['commandId', 'projectId', 'statementId', 'subjectConfigId', 'priceRevisionIds', 'sourceVersion', 'outcome', 'logIds', 'book', 'managementBookId', 'managementRevisionId', 'feeRevisionIds', 'negativeLineRevisionIds', 'locatedExistingDraft'])
  if (v.commandId !== command.commandId || v.projectId !== command.projectId || !feeNullableId(v.statementId) || (command.statementId !== null && v.statementId !== command.statementId) || !feeNullableId(v.subjectConfigId) || !feeArray(v.priceRevisionIds, feeId) || !isPayrollABook(v.book) || !feeNullableId(v.managementBookId) || !feeNullableId(v.managementRevisionId) || !feeArray(v.feeRevisionIds, feeId) || !feeArray(v.negativeLineRevisionIds, feeId) || !feeArray(v.logIds, feeId) || !feeText(v.sourceVersion) || !['saved', 'checked', 'released', 'needs-recheck'].includes(String(v.outcome)) || typeof v.locatedExistingDraft !== 'boolean')
    fail()
  return v as unknown as PayrollAFeesCommandResult
}
