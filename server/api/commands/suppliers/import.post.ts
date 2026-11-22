import { resolveBusinessSession } from '../../../utils/business-session'
import { demoWorkspaceTestInstance } from '../../../utils/demo-workspace-test-instance'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { productionSupplierRuntime } from '../../../utils/production-supplier-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { parseSupplierImportCommandRequest } from '../../../utils/supplier-command-request'
import { supplierCommandTestInstance } from '../../../utils/supplier-command-test-instance'

export default defineEventHandler(async (event) => {
  try {
    const production = productionSupplierRuntime()
    if (production)
      return await production.suppliers.importRow(await readBody(event), productionSession(event))
    return await supplierCommandTestInstance.importRow(
      parseSupplierImportCommandRequest(await readBody(event)),
      { ...resolveBusinessSession(), capabilities: demoWorkspaceTestInstance.capabilities(getHeader(event, 'x-ruihang-test-session')) },
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
