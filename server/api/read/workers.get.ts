import { crewWorkerReadTestInstance } from '../../utils/crew-worker-read-test-instance'
import { productionCrewWorkerRuntime } from '../../utils/production-crew-worker-runtime'
import { productionSession, throwProductionStorageError } from '../../utils/production-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const production = productionCrewWorkerRuntime()
    if (production)
      return await production.crews.listWorkers(getQuery(event), productionSession(event))
    return await crewWorkerReadTestInstance.listWorkers(getQuery(event), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
