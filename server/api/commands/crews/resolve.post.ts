import { defineEventHandler, getHeader, readBody } from 'h3'
import { resolveBusinessSession } from '../../../utils/business-session'
import { parseResolveCommandBody } from '../../../utils/command-journal'
import { crewWorkerCommandTestInstance } from '../../../utils/crew-worker-command-test-instance'
import { productionCrewWorkerRuntime } from '../../../utils/production-crew-worker-runtime'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const production = productionCrewWorkerRuntime()
    if (production)
      return await production.crews.resolve('crew', parseResolveCommandBody(await readBody(event)), productionSession(event))
    const commandId = parseResolveCommandBody(await readBody(event))
    return crewWorkerCommandTestInstance.resolve('crew', commandId, resolveBusinessSession(), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
