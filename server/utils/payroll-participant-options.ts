import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollParticipantOption, PayrollParticipantOptions, PayrollWritableContext } from '../../app/lib/payroll/central-contract'
import type { NavigationIntentDTO } from '../../app/types/read-model'
import type { PayrollIdentitySource } from './payroll-service'

export function payrollWorkerNavigation(context: PayrollWritableContext, projectId: string, id: string, name: string | null): NavigationIntentDTO | null {
  return context.capabilities.includes('worker:list:read') ? { kind: 'entity-detail', subject: { state: 'resolved', entity: 'worker', id, label: name ?? id, no: null }, variant: 'detail', view: null, filters: { projectId, dataOrigin: context.origin } } : null
}
export async function loadPayrollParticipantOptions(_db: TransactionDb, source: PayrollIdentitySource, context: PayrollWritableContext, projectId: string): Promise<PayrollParticipantOptions> {
  if (!source.projects.some(p => p.id === projectId))
    return { projects: source.projects, crews: [], workers: [] }
  const workers: PayrollParticipantOption[] = source.workers
    .map(w => ({ id: w.id, name: w.name, crewId: w.crewId, eligible: w.crewId === null || source.crews.some(c => c.id === w.crewId), reasons: w.crewId !== null && !source.crews.some(c => c.id === w.crewId) ? ['工人原档案班组不存在或已停用'] : [], historical: false, source: payrollWorkerNavigation(context, projectId, w.id, w.name) }))
  return { projects: source.projects, crews: source.crews.filter(c => workers.some(w => w.crewId === c.id)).map(c => ({ id: c.id, name: c.name, eligible: true, reasons: [] })), workers }
}
