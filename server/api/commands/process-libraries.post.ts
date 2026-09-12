import { parseProcessLibraryCommand } from '../../utils/process-library-request'
import { processLibraryService, processLibrarySession } from '../../utils/process-library-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    return processLibraryService.execute(parseProcessLibraryCommand(await readBody(event)), processLibrarySession(sessionId), sessionId)
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
