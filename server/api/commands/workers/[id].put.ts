import { resolveBusinessSession } from '../../../utils/business-session'
import { parseWorkerCommandRequest } from '../../../utils/crew-worker-command-request'
import { crewWorkerCommandTestInstance } from '../../../utils/crew-worker-command-test-instance'
import { productionCrewWorkerRuntime } from '../../../utils/production-crew-worker-runtime'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const production = productionCrewWorkerRuntime()
    if (production)
      return await production.crews.executeWorker(await readBody(event), productionSession(event), getRouterParam(event, 'id') ?? '')
    const id = getRouterParam(event, 'id') ?? ''
    return await crewWorkerCommandTestInstance.executeWorker(
      parseWorkerCommandRequest(await readBody(event), id),
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
