import type { H3Event } from 'h3'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { payrollRuntimeOptions, payrollSession } from './payroll-runtime'
import { createPayrollService } from './payroll-service'
import { createPayrollWorkbookService } from './payroll-workbook-service'
import { productionPayrollRuntime } from './production-payroll-runtime'
import { quantityTestInstance } from './quantity-runtime'
import { WorkspaceTransactionSessionChanged } from './quantity-test-instance'
import { workerRosterRuntimeOptions } from './worker-roster-runtime'
import { createWorkerRosterService } from './worker-roster-service'

export const payrollWorkbookService = createPayrollWorkbookService({
  session: payrollSession,
  payroll: (db, sessionId) => createPayrollService({ ...payrollRuntimeOptions, session: () => payrollSession(sessionId), identities: () => payrollRuntimeOptions.identities(sessionId), transaction: work => work(db, payrollSession(sessionId)) }),
  roster: (db, sessionId) => createWorkerRosterService({ ...workerRosterRuntimeOptions, session: () => workerRosterRuntimeOptions.session(sessionId), source: () => workerRosterRuntimeOptions.source(sessionId), transaction: work => work(db) }),
  async transaction(work, sessionId) {
    try {
      return await quantityTestInstance.withWorkspaceTransaction(work, sessionId)
    }
    catch (cause) {
      if (cause instanceof WorkspaceTransactionSessionChanged)
        throw payrollProblem('forbidden', '归档期间工作区、身份或权限已变化')
      throw cause
    }
  },
})
export function payrollWorkbookServiceForEvent(event: H3Event) {
  return productionPayrollRuntime(event)?.workbook ?? payrollWorkbookService
}
