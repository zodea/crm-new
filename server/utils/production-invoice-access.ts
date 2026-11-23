const id = String.raw`[A-Za-z0-9][\w-]{2,79}`
const detail = new RegExp(`^/api/read/invoices/${id}(?:/originals/${id})?$`)
const workbook = new RegExp(`^/api/read/invoice-workbooks/${id}$`)
const invoiceWorkbooks = new RegExp(`^/api/read/invoice-workbooks/by-invoice/${id}$`)
const correctionDetail = new RegExp(`^/api/read/invoice-corrections/(?!start(?:/|$)|list(?:/|$))${id}(?:/history|/files/${id})?$`)
export const PRODUCTION_INVOICE_CAPABILITIES = ['finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import'] as const

/** 只开放已经实现并各自执行可信会话、能力和事务核验的发票入口。 */
export function isProductionInvoiceRoute(method: string, path: string) {
  return (method === 'GET' && (path === '/api/read/invoices' || path === '/api/read/invoices/migration-state' || detail.test(path) || correctionDetail.test(path) || workbook.test(path) || invoiceWorkbooks.test(path)))
    || (method === 'POST' && [
      '/api/read/invoices/import-preview',
      '/api/read/invoices/migration-preview',
      '/api/read/invoices/migration-catalog',
      '/api/read/invoices/workspace-catalog',
      '/api/read/invoices/migration-mapping',
      '/api/read/invoice-corrections/start',
      '/api/read/invoice-corrections/list',
      '/api/commands/invoice-corrections/save',
      '/api/commands/invoice-corrections/submit',
      '/api/commands/invoice-corrections/submit-workbook',
      '/api/commands/invoice-corrections/resolve',
      '/api/commands/invoices',
      '/api/commands/invoices/import-workbook',
      '/api/commands/invoices/resolve',
      '/api/commands/invoices/print',
      '/api/commands/invoices/print-resolve',
      '/api/commands/invoices/migration-publish',
      '/api/commands/invoices/migration-resolve',
      '/api/commands/invoices/migration-retire',
    ].includes(path))
}
