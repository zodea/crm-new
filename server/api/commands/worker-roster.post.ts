import { productionCrewWorkerRuntime } from '../../utils/production-crew-worker-runtime'
import { productionSession, throwProductionStorageError } from '../../utils/production-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'
import { workerRosterService } from '../../utils/worker-roster-runtime'

export default defineEventHandler(async (event) => {
  try {
    const production = productionCrewWorkerRuntime()
    if (production)
      return await production.crews.executeRoster(await readBody(event), productionSession(event))
    return await workerRosterService.execute(await readBody(event), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
