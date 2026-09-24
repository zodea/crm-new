import { processLibraryOrigin, processLibraryService, processLibrarySession } from '../../utils/process-library-runtime'
import { productionProcessLibraries } from '../../utils/production-process-library-runtime'
import { productionSession, throwProductionStorageError } from '../../utils/production-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'
import { projectScheduleLibraryUsage } from '../../utils/schedule-usage'

export default defineEventHandler(async (event) => {
  try {
    const production = productionProcessLibraries()
    if (production)
      return await production.catalog(processLibraryOrigin(getQuery(event)), productionSession(event))
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    const session = processLibrarySession(sessionId)
    const catalog = processLibraryService.catalog(processLibraryOrigin(getQuery(event)), session, sessionId)
    return { ...catalog, libraries: await projectScheduleLibraryUsage(catalog.libraries, session, sessionId) }
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
