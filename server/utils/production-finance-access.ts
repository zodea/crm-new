const kinds = '(?:current|reimbursement|payment_application|payment_record|invoice_application)'
const id = '[A-Za-z0-9][\\w-]{2,99}'
const reads = new RegExp(`^/api/read/finance/${kinds}/(?:context|list|lookup|customer/${id}|form/${id}|files/${id}/${id})$`)
const paymentDetail = new RegExp(`^/api/read/finance/payment_application/detail/${id}$`)
export function isProductionFinanceRoute(method: string, path: string) {
  return (method === 'GET' && (reads.test(path) || paymentDetail.test(path) || path === '/api/read/finance/import')) || (method === 'POST' && ['/api/commands/finance', '/api/commands/finance/resolve', '/api/commands/finance/import', '/api/commands/finance/import/preflight', '/api/commands/finance/import/resolve'].includes(path))
}
export { FINANCE_CAPABILITIES, FINANCE_IMPORT_CAPABILITY } from '../../app/lib/finance/central-contract'
