import { resolveBusinessSession } from '../../../utils/business-session'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { parseSupplierImportCommandRequest } from '../../../utils/supplier-command-request'
import { supplierCommandTestInstance } from '../../../utils/supplier-command-test-instance'

export default defineEventHandler(async (event) => {
  try {
    return await supplierCommandTestInstance.importRow(
      parseSupplierImportCommandRequest(await readBody(event)),
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
