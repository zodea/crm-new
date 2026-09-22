import { readPayrollStatement } from '../../app/lib/payroll/central-read'
import { initializePayrollSchema } from '../../app/lib/payroll/central-schema'
import { rosterProblem } from '../../app/lib/worker-roster/contract'
import { resolveBusinessSession } from './business-session'
import { crewWorkerCommandTestInstance } from './crew-worker-command-test-instance'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { projectReadTestInstance } from './project-read-test-instance'
import { quantityTestInstance } from './quantity-runtime'
import { WorkspaceTransactionSessionChanged } from './quantity-test-instance'
import { createWorkerRosterService } from './worker-roster-service'
import { rosterHash } from './worker-roster-storage'

export const workerRosterService = createWorkerRosterService({
  session: sessionId => ({ ...resolveBusinessSession(), capabilities: demoWorkspaceTestInstance.capabilities(sessionId) }),
  source: sessionId => ({
    workers: crewWorkerCommandTestInstance.workerRows(sessionId).filter(row => row.dataOrigin === 'real'),
    projects: projectReadTestInstance.identities(sessionId).rows.filter(row => row.dataOrigin === 'real').map(row => ({ id: row.id, name: row.name })),
  }),
  async statements(db, scope) {
    await initializePayrollSchema(db)
    const rows = []
    for (const id of scope.statementIds) {
      const row = await readPayrollStatement(db, id)
      if (row.hidden || row.deletedAt || row.recordKind !== 'central' || row.snapshot.state !== 'complete')
        return rosterProblem('validation-failed', '所选工资不可见、不是中央工资或冻结资料不完整')
      rows.push({ id, projectId: row.projectId, status: row.status, formatFamily: row.formatFamily, members: row.members.map(member => ({ workerId: member.workerId ?? '', workerName: member.workerName ?? '', isLeader: member.isLeader })), proof: rosterHash({ snapshot: row.snapshot.originalRaw, members: row.members }) })
    }
    return rows
  },
  async transaction(work, sessionId) {
    try {
      return await quantityTestInstance.withWorkspaceTransaction(work, sessionId)
    }
    catch (cause) {
      if (cause instanceof WorkspaceTransactionSessionChanged)
        return rosterProblem('forbidden', '处理期间名册工作区或身份已变化')
      throw cause
    }
  },
})
