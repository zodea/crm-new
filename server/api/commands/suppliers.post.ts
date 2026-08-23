import { resolveBusinessSession } from '../../utils/business-session'
import { throwProjectReadError } from '../../utils/project-read-error'
import { parseSupplierCommandRequest } from '../../utils/supplier-command-request'
import { supplierCommandTestInstance } from '../../utils/supplier-command-test-instance'

export default defineEventHandler(async (event) => {
  try {
    return await supplierCommandTestInstance.execute(
      parseSupplierCommandRequest(await readBody(event)),
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
