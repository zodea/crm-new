import { resolveBusinessSession } from '../../../../utils/business-session'
import { throwProjectReadError } from '../../../../utils/project-read-error'
import { supplierCommandTestInstance } from '../../../../utils/supplier-command-test-instance'

export default defineEventHandler(async (event) => {
  try {
    return supplierCommandTestInstance.form(
      getRouterParam(event, 'id') ?? '',
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
