import { throwProjectReadError } from '../../../../utils/project-read-error'
import { projectSupplierReadTestInstance } from '../../../../utils/project-supplier-read-test-instance'

export default defineEventHandler(async (event) => {
  try {
    return await projectSupplierReadTestInstance.detail(
      getRouterParam(event, 'projectId') ?? '',
      getRouterParam(event, 'supplierId') ?? '',
      getQuery(event),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
