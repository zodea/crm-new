import { crewWorkerReadTestInstance } from '../../../../utils/crew-worker-read-test-instance'
import { throwProjectReadError } from '../../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    return await crewWorkerReadTestInstance.relationFactIdentity(
      getRouterParam(event, 'kind') ?? '',
      getRouterParam(event, 'id') ?? '',
      getQuery(event),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
