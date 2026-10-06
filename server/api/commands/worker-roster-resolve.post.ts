import type { WorkerRosterCommand } from '../../../app/lib/worker-roster/contract'
import { rosterProblem } from '../../../app/lib/worker-roster/contract'
import { rosterObject } from '../../../app/lib/worker-roster/validation'
import { productionCrewWorkerRuntime } from '../../utils/production-crew-worker-runtime'
import { productionSession, throwProductionStorageError } from '../../utils/production-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'
import { workerRosterService } from '../../utils/worker-roster-runtime'

export default defineEventHandler(async (event) => {
  try {
    const body: unknown = await readBody(event)
    if (!rosterObject(body) || Object.keys(body).some(key => !['commandId', 'action'].includes(key)))
      return rosterProblem('invalid-query', '待核对提交无效')
    const production = productionCrewWorkerRuntime()
    if (production)
      return await production.crews.resolveRoster(String(body.commandId ?? ''), body.action as WorkerRosterCommand['action'], productionSession(event))
    return await workerRosterService.resolve(String(body.commandId ?? ''), body.action as WorkerRosterCommand['action'], getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
