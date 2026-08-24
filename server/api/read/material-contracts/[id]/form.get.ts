import { resolveBusinessSession } from '../../../../utils/business-session'
import { materialContractCommandTestInstance } from '../../../../utils/material-contract-command-test-instance'
import { throwProjectReadError } from '../../../../utils/project-read-error'

export default defineEventHandler((event) => {
  try {
    return materialContractCommandTestInstance.form(
      getRouterParam(event, 'id') ?? '',
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
