import { productionCrewWorkerRuntime } from '../../../utils/production-crew-worker-runtime'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { workerRosterService } from '../../../utils/worker-roster-runtime'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  try {
    const production = productionCrewWorkerRuntime()
    if (production)
      return await production.crews.rosterFile({ workerId: String(query.workerId ?? ''), assetId: String(query.assetId ?? ''), ...(query.archiveId ? { projectId: String(query.projectId ?? ''), archiveId: String(query.archiveId) } : {}) }, productionSession(event))
    return await workerRosterService.file({ workerId: String(query.workerId ?? ''), assetId: String(query.assetId ?? ''), ...(query.archiveId ? { projectId: String(query.projectId ?? ''), archiveId: String(query.archiveId) } : {}) }, getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
