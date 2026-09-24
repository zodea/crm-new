import { parseProcessLibraryCommand } from '../../utils/process-library-request'
import { processLibraryService, processLibrarySession } from '../../utils/process-library-runtime'
import { productionProcessLibraries } from '../../utils/production-process-library-runtime'
import { productionSession, throwProductionStorageError } from '../../utils/production-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const production = productionProcessLibraries()
    if (production)
      return await production.execute(await readBody(event), productionSession(event))
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    return processLibraryService.execute(parseProcessLibraryCommand(await readBody(event)), processLibrarySession(sessionId), sessionId)
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
