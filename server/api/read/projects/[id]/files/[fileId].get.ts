import { Buffer } from 'node:buffer'
import { requireProductionProjects } from '../../../../../utils/production-project-runtime'
import { productionSession, throwProductionStorageError } from '../../../../../utils/production-runtime'
import { throwProjectReadError } from '../../../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const file = await requireProductionProjects().file(getRouterParam(event, 'id') ?? '', getRouterParam(event, 'fileId') ?? '', productionSession(event))
    setHeader(event, 'Cache-Control', 'no-store')
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    setHeader(event, 'Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
    setHeader(event, 'X-Content-SHA256', file.sha256)
    return send(event, Buffer.from(file.bytes), 'application/octet-stream')
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
