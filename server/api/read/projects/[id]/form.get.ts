import { resolveBusinessSession } from '../../../../utils/business-session'
import { projectCommandTestInstance } from '../../../../utils/project-command-test-instance'
import { throwProjectReadError } from '../../../../utils/project-read-error'

export default defineEventHandler((event) => {
  try {
    return projectCommandTestInstance.form(
      getRouterParam(event, 'id') ?? '',
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
