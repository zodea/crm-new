import { productionProjectRuntime } from '../../utils/production-project-runtime'
import { productionSession, throwProductionStorageError } from '../../utils/production-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'
import { projectReadTestInstance } from '../../utils/project-read-test-instance'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionProjectRuntime()
    if (runtime)
      return await runtime.projects.list(getQuery(event), productionSession(event))
    return await projectReadTestInstance.list(
      getQuery(event),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
