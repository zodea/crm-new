import { resolveBusinessSession } from '../../../../utils/business-session'
import { productionProjectRuntime } from '../../../../utils/production-project-runtime'
import { productionSession, throwProductionStorageError } from '../../../../utils/production-runtime'
import { projectCommandTestInstance } from '../../../../utils/project-command-test-instance'
import { throwProjectReadError } from '../../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionProjectRuntime()
    if (runtime)
      return await runtime.projects.form(getRouterParam(event, 'id') ?? '', productionSession(event))
    return projectCommandTestInstance.form(
      getRouterParam(event, 'id') ?? '',
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
