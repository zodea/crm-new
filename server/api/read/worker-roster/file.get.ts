import { throwProjectReadError } from '../../../utils/project-read-error'
import { workerRosterService } from '../../../utils/worker-roster-runtime'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  try {
    return await workerRosterService.file({ workerId: String(query.workerId ?? ''), assetId: String(query.assetId ?? ''), ...(query.archiveId ? { projectId: String(query.projectId ?? ''), archiveId: String(query.archiveId) } : {}) }, getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwProjectReadError(cause) }
})
