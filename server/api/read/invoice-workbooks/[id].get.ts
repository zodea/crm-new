import { Buffer } from 'node:buffer'
import { CentralInvoiceProblem } from '../../../../app/lib/invoice/central-contract'
import { productionInvoiceSession, requireProductionInvoices, throwProductionInvoiceError } from '../../../utils/production-invoice-runtime'

export default defineEventHandler(async (event) => {
  try {
    const file = await requireProductionInvoices().workbook(getRouterParam(event, 'id') ?? '', productionInvoiceSession(event))
    if (!file.fileName.isWellFormed())
      throw new CentralInvoiceProblem('unavailable', '工作簿文件名无法安全编码，请保留原件并核对来源。')
    const encodedName = encodeURIComponent(file.fileName).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    setHeader(event, 'Cache-Control', 'private, no-store')
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    setHeader(event, 'Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`)
    setHeader(event, 'X-Content-SHA256', file.sha256)
    return send(event, Buffer.from(file.bytes), 'application/octet-stream')
  }
  catch (cause) { throwProductionInvoiceError(cause) }
})
