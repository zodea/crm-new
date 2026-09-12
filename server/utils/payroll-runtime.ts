import { createHash } from 'node:crypto'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { resolveBusinessSession } from './business-session'
import { crewWorkerCommandTestInstance } from './crew-worker-command-test-instance'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { createPayrollService } from './payroll-service'
import { projectReadTestInstance } from './project-read-test-instance'
import { quantityTestInstance } from './quantity-runtime'
import { WorkspaceTransactionSessionChanged } from './quantity-test-instance'

export function payrollSession(sessionId?: string | null) {
  return { ...resolveBusinessSession(), capabilities: demoWorkspaceTestInstance.capabilities(sessionId) }
}
export function payrollIdentitySource(sessionId?: string | null) {
  const projects = projectReadTestInstance.identities(sessionId).rows.filter(row => row.dataOrigin === 'real').map(row => ({ id: row.id, name: row.name, code: row.code ?? '' }))
  const crews = crewWorkerCommandTestInstance.crewRows(sessionId).filter(row => row.dataOrigin === 'real').map(row => ({ id: row.id, name: row.name }))
  const workers = crewWorkerCommandTestInstance.workerRows(sessionId).filter(row => row.dataOrigin === 'real' && (!row.crewId || crews.some(crew => crew.id === row.crewId))).map(row => ({ id: row.id, name: row.name, crewId: row.crewId }))
  return { projects, crews, workers, version: createHash('sha256').update(JSON.stringify([projects, crews, workers])).digest('hex') }
}
export const payrollService = createPayrollService({ session: payrollSession, identities: payrollIdentitySource, async transaction(work, sessionId) {
  try {
    return await quantityTestInstance.withWorkspaceTransaction(work, sessionId)
  }
  catch (cause) {
    if (cause instanceof WorkspaceTransactionSessionChanged)
      throw payrollProblem('forbidden', '读取期间工资工作区或身份已变化')
    throw cause
  }
} })
export function payrollDemoContext(includeDemo: boolean, sessionId?: string | null) {
  const session = payrollSession(sessionId)
  if (!includeDemo || !session.capabilities.includes('demo:read') || !session.capabilities.includes('payroll:read'))
    throw payrollProblem('forbidden', '当前身份没有演示工资读取权限')
  return { context: { ...session, readonly: true as const, origin: 'demo' as const, sourceVersion: 'demo-payroll-readonly-v1' }, rows: [], projects: [], diagnostics: [] }
}
