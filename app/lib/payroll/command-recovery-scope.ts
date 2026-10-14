import { payrollCanonical } from './central-command-shared'

/** Identity context only. No wage inputs, allocations, prices or source-version bodies. */
export function payrollCommandRecoveryScope(command: object): string {
  const value = command as Record<string, unknown>
  const action = value.action as { kind: string, record?: { workerId: string, workDate: string }, input?: { projectId?: string, month?: string, planId?: string } }
  const identity = [value.workspaceId, value.actorId, value.origin]
  let key: unknown[]
  switch (action.kind) {
    case 'upsert-attendance':
      key = [...identity, 'attendance', value.projectId, action.record!.workerId, action.record!.workDate]
      break
    case 'save-daywork':
    case 'confirm-daywork':
      key = [...identity, 'daywork', value.recordId ?? value.draftKey]
      break
    case 'save-a-rounding':
      key = [...identity, value.scope]
      break
    case 'save-adjustment-draft':
    case 'confirm-adjustment':
    case 'confirm-actual-payment':
    case 'confirm-recording-reversal':
      key = [...identity, value.projectId, value.target]
      break
    case 'save-hollow-policies':
    case 'start-hollow-deduction':
      key = [...identity, value.target ?? value.config]
      break
    case 'confirm-batch':
      key = [...identity, 'scope', action.input!.projectId, action.input!.month]
      break
    case 'prepare-batch-item':
    case 'execute-batch-original':
      key = [...identity, 'plan', action.input!.planId]
      break
    case 'initialize':
    case 'issue':
      key = [value.workspaceId, value.actorId, value.projectId, value.statementId]
      break
    default:
      key = [...identity, ...(action.kind.includes('-c1') ? ['C1'] : action.kind.includes('-c2') ? ['C2'] : []), value.configScope ?? value.statementId ?? value.draftKey]
  }
  return encodeURIComponent(payrollCanonical(key))
}
