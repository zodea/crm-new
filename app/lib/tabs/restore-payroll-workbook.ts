import type { TabRestoreResult } from './restoration-contract'
import type { DomainRepositories } from '~/plugins/repositories'
import { checkRestoreAbort } from './restore-problem'

/** Persist only public route identities; both directory and private files are read afresh. */
export async function readRestoredPayrollWorkbook(repositories: DomainRepositories, fullPath: string, projectId: string | null, archiveId: string | null, signal?: AbortSignal): Promise<TabRestoreResult> {
  const list = await repositories.payroll.list({ origin: 'real', ...(projectId ? { projectId } : {}) })
  checkRestoreAbort(signal)
  if (projectId && archiveId)
    await repositories.payroll.workbookArchive({ origin: 'real', projectId }, { projectId, archiveId })
  else if (projectId)
    await repositories.payroll.workbookArchives({ origin: 'real', projectId }, { projectId })
  checkRestoreAbort(signal)
  return { state: 'resolved', fullPath, title: '完整工资工作簿', sourceVersion: list.context.sourceVersion }
}
