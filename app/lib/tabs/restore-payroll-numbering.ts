import type { TabRestoreResult } from './restoration-contract'
import type { DomainRepositories } from '~/plugins/repositories'
import { checkRestoreAbort } from './restore-problem'

export async function readRestoredPayrollNumbering(repositories: DomainRepositories, fullPath: string, projectId: string, statementId: string, signal?: AbortSignal): Promise<TabRestoreResult> {
  const read = await repositories.payroll.numbering({ origin: 'real', projectId }, { projectId, statementId })
  checkRestoreAbort(signal)
  return { state: 'resolved', fullPath, title: '预览与正式出具工资', sourceVersion: read.context.sourceVersion }
}
