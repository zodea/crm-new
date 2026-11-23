import { CentralInvoiceProblem } from '../../../../app/lib/invoice/central-contract'
import { productionInvoiceSession, requireProductionInvoiceCorrections } from '../../../utils/production-invoice-runtime'
import { readInvoiceWorkbookRequest } from '../../../utils/production-invoice-workbook-request'
import { throwWorkbookCommandError, workbookSession } from '../../../utils/production-invoice-workbook-session'

export default defineEventHandler(async (event) => {
  try {
    const session = workbookSession(productionInvoiceSession(event))
    const actor = session()
    if (!['finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import'].every(capability => actor.capabilities.includes(capability)))
      throw new CentralInvoiceProblem('forbidden', '当前身份没有发票导入权限。')
    const input = await readInvoiceWorkbookRequest(event)
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'command,workbook')
      throw new CentralInvoiceProblem('validation-failed', '工作簿更正请求格式无效。')
    const body = input as Record<string, unknown>
    return await requireProductionInvoiceCorrections().submit(body.command, session, body.workbook)
  }
  catch (cause) { throwWorkbookCommandError(cause) }
})
