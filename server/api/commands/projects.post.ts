import { resolveBusinessSession } from '../../utils/business-session'
import { productionProjectRuntime } from '../../utils/production-project-runtime'
import { productionSession, throwProductionStorageError } from '../../utils/production-runtime'
import { parseProjectCommandRequest } from '../../utils/project-command-request'
import { projectCommandTestInstance } from '../../utils/project-command-test-instance'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionProjectRuntime()
    if (runtime)
      return await runtime.projects.execute(await readBody(event), productionSession(event), null)
    return await projectCommandTestInstance.execute(
      parseProjectCommandRequest(await readBody(event)),
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
