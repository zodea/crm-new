import { resolveBusinessSession } from '../../../utils/business-session'
import { parseProjectCommandRequest } from '../../../utils/project-command-request'
import { projectCommandTestInstance } from '../../../utils/project-command-test-instance'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    return await projectCommandTestInstance.execute(
      parseProjectCommandRequest(await readBody(event), getRouterParam(event, 'id') ?? ''),
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
