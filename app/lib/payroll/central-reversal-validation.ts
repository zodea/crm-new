import type { PayrollActualReversalDraft, PayrollActualReversalTarget } from './central-actual-contract'
import type { PayrollActualReversalCommand } from './central-adjustment-contract'
import { payrollProblem } from './central-contract'
import { wireExact, wireId, wireObject, wireText } from './central-payroll-wire'

function fail(): never {
  throw payrollProblem('validation-failed', '错记冲销须引用具体原收付、固定草稿并明确填写核查依据')
}
export function assertPayrollReversalTarget(v: unknown): asserts v is PayrollActualReversalTarget {
  wireExact(v, ['kind', 'draftKey', 'original'])
  if (v.kind !== 'recording-reversal' || !wireId(v.draftKey) || !wireObject(v.original))
    fail()
  wireExact(v.original, v.original.kind === 'released-statement' ? ['kind', 'statementId'] : ['kind', 'eventId'])
  if (v.original.kind === 'released-statement' ? !wireId(v.original.statementId) : v.original.kind !== 'actual-event' || !wireId(v.original.eventId))
    fail()
}
export function assertPayrollReversalDraft(v: unknown): asserts v is PayrollActualReversalDraft {
  wireExact(v, ['confirmedNotOccurred', 'confirmedOn', 'evidenceNote'])
  if (typeof v.confirmedNotOccurred !== 'boolean' || !wireText(v.confirmedOn) || !wireText(v.evidenceNote))
    fail()
}
export function assertPayrollReversalCommand(v: unknown): asserts v is PayrollActualReversalCommand {
  wireExact(v, ['commandId', 'workspaceId', 'actorId', 'origin', 'requiredCapability', 'sourceVersion', 'projectId', 'target', 'action'])
  if (![v.commandId, v.workspaceId, v.actorId, v.projectId].every(wireId) || !['real', 'demo'].includes(String(v.origin)) || v.requiredCapability !== 'payroll:write' || !wireText(v.sourceVersion) || !v.sourceVersion)
    fail()
  assertPayrollReversalTarget(v.target)
  wireExact(v.action, ['kind', 'reversal'])
  if (v.action.kind !== 'confirm-recording-reversal')
    fail()
  assertPayrollReversalDraft(v.action.reversal)
}
