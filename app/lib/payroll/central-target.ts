import type { PayrollStatementRow } from './central-contract'
import type { PayrollViewScope } from './central-navigation'
import { resolveNavigationTarget } from '../nav/target-registry'
import { payrollViewQuery } from './central-navigation'

export function payrollStatementTarget(row: Pick<PayrollStatementRow, 'id' | 'month' | 'leaderName'>, scope: PayrollViewScope, returnTo: string): string | null {
  if (!scope.origin || scope.error)
    return null
  const result = resolveNavigationTarget({ kind: 'entity-detail', subject: { state: 'resolved', entity: 'wage-statement', id: row.id, label: `${row.month} · ${row.leaderName || '负责人未记录'}`, no: null }, variant: 'detail', view: null, filters: { ...payrollViewQuery(scope), dataOrigin: scope.origin } }, { returnTo })
  return result.state === 'resolved' ? result.to : null
}
