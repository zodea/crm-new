import { processLibraryOrigin, processLibraryService, processLibrarySession } from '../../../utils/process-library-runtime'
import { productionProcessLibraries } from '../../../utils/production-process-library-runtime'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { projectScheduleLibraryUsage } from '../../../utils/schedule-usage'

export default defineEventHandler(async (event) => {
  try {
    const production = productionProcessLibraries()
    if (production)
      return await production.detail(getRouterParam(event, 'id') || '', processLibraryOrigin(getQuery(event)), productionSession(event))
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    const session = processLibrarySession(sessionId)
    const detail = processLibraryService.detail(getRouterParam(event, 'id') || '', processLibraryOrigin(getQuery(event)), session, sessionId)
    return (await projectScheduleLibraryUsage([detail], session, sessionId))[0]!
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
