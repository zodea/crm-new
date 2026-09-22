import { processLibraryOrigin, processLibraryService, processLibrarySession } from '../../../utils/process-library-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { projectScheduleLibraryUsage } from '../../../utils/schedule-usage'

export default defineEventHandler(async (event) => {
  try {
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    const session = processLibrarySession(sessionId)
    const detail = processLibraryService.detail(getRouterParam(event, 'id') || '', processLibraryOrigin(getQuery(event)), session, sessionId)
    return (await projectScheduleLibraryUsage([detail], session, sessionId))[0]!
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
