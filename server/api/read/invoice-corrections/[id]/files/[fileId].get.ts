import { Buffer } from 'node:buffer'
import { productionInvoiceSession, requireProductionInvoiceCorrections, throwProductionInvoiceError } from '../../../../../utils/production-invoice-runtime'

export default defineEventHandler(async (event) => {
  try {
    const file = await requireProductionInvoiceCorrections().file(getRouterParam(event, 'id') ?? '', getRouterParam(event, 'fileId') ?? '', productionInvoiceSession(event))
    setHeader(event, 'Cache-Control', 'private, no-store')
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    setHeader(event, 'Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
    setHeader(event, 'X-Content-SHA256', file.sha256)
    return send(event, Buffer.from(file.bytes), 'application/octet-stream')
  }
  catch (cause) { throwProductionInvoiceError(cause) }
})
