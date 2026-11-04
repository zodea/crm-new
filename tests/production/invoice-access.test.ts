import { describe, expect, it } from 'vitest'
import { isProductionInvoiceRoute } from '../../server/utils/production-invoice-access'

describe('正式发票路由边界', () => {
  it('仅允许已实现的指定方法与入口', () => {
    for (const path of ['/api/read/invoices', '/api/read/invoices/migration-state', '/api/read/invoices/invoice-one', '/api/read/invoices/invoice-one/originals/original-one', '/api/read/invoice-corrections/correction-one', '/api/read/invoice-corrections/correction-one/history', '/api/read/invoice-corrections/correction-one/files/file-one'])
      expect(isProductionInvoiceRoute('GET', path)).toBe(true)
    for (const path of ['/api/read/invoices/import-preview', '/api/read/invoices/migration-preview', '/api/read/invoices/migration-catalog', '/api/read/invoices/workspace-catalog', '/api/read/invoices/migration-mapping', '/api/read/invoice-corrections/start', '/api/read/invoice-corrections/list', '/api/commands/invoice-corrections/save', '/api/commands/invoice-corrections/submit', '/api/commands/invoice-corrections/resolve', '/api/commands/invoices', '/api/commands/invoices/resolve', '/api/commands/invoices/print', '/api/commands/invoices/print-resolve', '/api/commands/invoices/migration-publish', '/api/commands/invoices/migration-resolve', '/api/commands/invoices/migration-retire'])
      expect(isProductionInvoiceRoute('POST', path)).toBe(true)
    for (const [method, path] of [['POST', '/api/commands/invoices/unknown'], ['DELETE', '/api/commands/invoices'], ['GET', '/api/read/invoices/../other'], ['GET', '/api/read/invoices/invoice-one/originals/file-one/extra'], ['POST', '/api/read/invoices/invoice-one'], ['GET', '/api/read/invoice-corrections/start'], ['GET', '/api/read/invoice-corrections/correction-one/files/file-one/extra'], ['POST', '/api/read/invoice-corrections/correction-one/history'], ['GET', '/api/commands/invoice-corrections/submit']])
      expect(isProductionInvoiceRoute(method!, path!)).toBe(false)
  })
})
