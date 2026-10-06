import { Buffer } from 'node:buffer'
import { financeApi, financeRouteKind, throwFinanceError } from '../../../../../../utils/finance-api'
import { financeId } from '../../../../../../utils/production-finance-request'

export default defineEventHandler(async (event) => {
  try {
    const source = financeApi(event)
    const original = await source.finance.original(financeRouteKind(event), financeId(getRouterParam(event, 'id')), financeId(getRouterParam(event, 'fileId')), source.session)
    setResponseHeader(event, 'Content-Type', original.mimeType)
    setResponseHeader(event, 'Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(original.fileName)}`)
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    return send(event, Buffer.from(original.bytes))
  }
  catch (cause) { throwFinanceError(cause) }
})
