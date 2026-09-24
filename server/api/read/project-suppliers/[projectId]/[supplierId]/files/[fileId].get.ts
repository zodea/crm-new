import { resolveBusinessSession } from '../../../../../../utils/business-session'
import { throwProjectReadError } from '../../../../../../utils/project-read-error'
import { parseProjectSupplierFileQuery, projectSupplierFileService } from '../../../../../../utils/project-supplier-file-service'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  try {
    const query = parseProjectSupplierFileQuery(
      getRouterParam(event, 'projectId') ?? '',
      getRouterParam(event, 'supplierId') ?? '',
      getRouterParam(event, 'fileId') ?? '',
      getQuery(event),
    )
    return await projectSupplierFileService.getContent(query, resolveBusinessSession(), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
