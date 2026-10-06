import { crewWorkerReadTestInstance } from '../../../../utils/crew-worker-read-test-instance'
import { productionCrewWorkerRuntime } from '../../../../utils/production-crew-worker-runtime'
import { throwProductionStorageError } from '../../../../utils/production-runtime'
import { throwProjectReadError } from '../../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const production = productionCrewWorkerRuntime()
    if (production)
      return production.crews.relationFact()
    return await crewWorkerReadTestInstance.relationFactIdentity(
      getRouterParam(event, 'kind') ?? '',
      getRouterParam(event, 'id') ?? '',
      getQuery(event),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
