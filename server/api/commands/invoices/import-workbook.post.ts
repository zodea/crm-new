import { CentralInvoiceProblem } from '../../../../app/lib/invoice/central-contract'
import { productionInvoiceSession, requireProductionInvoices } from '../../../utils/production-invoice-runtime'
import { readInvoiceWorkbookRequest } from '../../../utils/production-invoice-workbook-request'
import { throwWorkbookCommandError, workbookSession } from '../../../utils/production-invoice-workbook-session'

export default defineEventHandler(async (event) => {
  try {
    const session = workbookSession(productionInvoiceSession(event))
    const actor = session()
    if (!['finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import'].every(capability => actor.capabilities.includes(capability)))
      throw new CentralInvoiceProblem('forbidden', '当前身份没有发票导入权限。')
    const input = await readInvoiceWorkbookRequest(event)
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'command,mapping,workbook')
      throw new CentralInvoiceProblem('validation-failed', '导入请求格式无效。')
    const body = input as Record<string, unknown>
    return await requireProductionInvoices().execute(body.command, session, body.workbook, body.mapping)
  }
  catch (cause) { throwWorkbookCommandError(cause) }
})
