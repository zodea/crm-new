import { resolveBusinessSession } from '../../utils/business-session'
import { parseWorkerCommandRequest } from '../../utils/crew-worker-command-request'
import { crewWorkerCommandTestInstance } from '../../utils/crew-worker-command-test-instance'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    return await crewWorkerCommandTestInstance.executeWorker(
      parseWorkerCommandRequest(await readBody(event)),
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
