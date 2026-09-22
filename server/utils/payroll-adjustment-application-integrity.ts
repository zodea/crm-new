import type { TransactionDb } from '../../app/lib/db/coordinator'
import { isPayrollActualSnapshot } from '../../app/lib/payroll/central-actual-codec'
import { wireId, wireObject } from '../../app/lib/payroll/central-payroll-wire'
import { isPayrollReleaseApplications } from '../../app/lib/payroll/central-release-adjustment-wire'
import { loadPayrollMigratedProof } from './payroll-migrated-proof'

/** 从原确认反向核对物理引用，删除一行应用不能重新生成可补退余额。 */
export async function payrollMissingApplicationReasons(tx: TransactionDb, projectId: string, adjustmentIds: string[], presentIds: string[]) {
  const reasons: string[] = []
  const imported = await loadPayrollMigratedProof(tx, projectId)
  const missing = (id: unknown, source: string) => {
    if (!wireId(id) || !presentIds.includes(id))
      reasons.push(`${source} 的原确认处理引用缺失，剩余暂不能证明`)
  }
  for (const event of await tx.select<{ id: string, confirmed_snapshot_json: string }>('SELECT id,confirmed_snapshot_json FROM payroll_actual_events WHERE project_id=?', [projectId])) {
    try {
      const snapshot: unknown = imported.snapshots.get(event.id) ?? JSON.parse(event.confirmed_snapshot_json)
      if (!isPayrollActualSnapshot(snapshot))
        throw new Error('原确认不可辨认')
      const applications = 'kind' in snapshot ? snapshot.applications : snapshot.draft.applications
      applications.forEach((application, index) => {
        if (adjustmentIds.includes(application.adjustmentId))
          missing(snapshot.applicationIds[index], event.id)
      })
    }
    catch { reasons.push(`工资收付 ${event.id} 的原处理对象无法核实，不能把缺失关系当作尚未处理`) }
  }
  const receipts = await tx.select<{ command_id: string, statement_id: string, command_json: string | null, result_json: string }>('SELECT command_id,statement_id,command_json,result_json FROM payroll_command_receipts WHERE project_id=? AND action IN (\'release-a\',\'release-c1\',\'release-c2\')', [projectId])
  for (const receipt of receipts) {
    if (imported.releasedApplications.has(receipt.statement_id))
      continue
    if (!receipt.command_json)
      continue
    try {
      const command: unknown = JSON.parse(receipt.command_json)
      if (!wireObject(command) || !wireObject(command.action) || !wireObject(command.action.release) || command.action.release.adjustmentApplications === undefined)
        continue
      const applications = command.action.release.adjustmentApplications
      if (!isPayrollReleaseApplications(applications))
        throw new Error('处理关系无效')
      const result: unknown = JSON.parse(receipt.result_json)
      applications.forEach((application, index) => {
        if (adjustmentIds.includes(application.adjustmentId))
          missing(wireObject(result) && Array.isArray(result.adjustmentApplicationIds) ? result.adjustmentApplicationIds[index] : null, receipt.command_id)
      })
    }
    catch { reasons.push(`工资发放 ${receipt.command_id} 的原处理关系缺损，请核查原回执`) }
  }
  return [...new Set(reasons)]
}
