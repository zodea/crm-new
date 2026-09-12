import { processLibraryOrigin, processLibraryService, processLibrarySession } from '../../../utils/process-library-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler((event) => {
  try {
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    return processLibraryService.detail(getRouterParam(event, 'id') || '', processLibraryOrigin(getQuery(event)), processLibrarySession(sessionId), sessionId)
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
