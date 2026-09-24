import { resolveBusinessSession } from '../../../utils/business-session'
import { parseCrewCommandRequest } from '../../../utils/crew-worker-command-request'
import { crewWorkerCommandTestInstance } from '../../../utils/crew-worker-command-test-instance'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id') ?? ''
    return await crewWorkerCommandTestInstance.executeCrew(
      parseCrewCommandRequest(await readBody(event), id),
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
