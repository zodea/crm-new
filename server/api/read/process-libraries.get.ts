import { processLibraryOrigin, processLibraryService, processLibrarySession } from '../../utils/process-library-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'
import { projectScheduleLibraryUsage } from '../../utils/schedule-usage'

export default defineEventHandler(async (event) => {
  try {
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    const session = processLibrarySession(sessionId)
    const catalog = processLibraryService.catalog(processLibraryOrigin(getQuery(event)), session, sessionId)
    return { ...catalog, libraries: await projectScheduleLibraryUsage(catalog.libraries, session, sessionId) }
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
