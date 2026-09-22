import type { TabRestoreResult } from './restoration-contract'
import type { DomainRepositories } from '~/plugins/repositories'
import { WORKER_PRIVATE_READ } from '~/lib/worker-roster/contract'
import { checkRestoreAbort, restoreProblem } from './restore-problem'

/** Restore only the authorized page identity; drafts and private content are re-read by the page. */
export async function readRestoredWorkerRoster(repositories: DomainRepositories, fullPath: string, workerId: string | null, projectId: string | null, signal?: AbortSignal): Promise<TabRestoreResult> {
  if (workerId) {
    const read = await repositories.workerRoster.profile(workerId)
    checkRestoreAbort(signal)
    return { state: 'resolved', fullPath, title: '工人私密资料', sourceVersion: read.sourceVersion }
  }
  const list = await repositories.payroll.list({ origin: 'real', ...(projectId ? { projectId } : {}) })
  if (!list.context.capabilities.includes(WORKER_PRIVATE_READ) || !list.context.capabilities.includes('payroll:read'))
    return restoreProblem('forbidden')
  if (projectId)
    await repositories.workerRoster.archives(projectId)
  checkRestoreAbort(signal)
  return { state: 'resolved', fullPath, title: '工资实名名册归档', sourceVersion: null }
}
