import type { InvoiceLedgerExportRow, InvoiceResolvedStyleConfig } from '~/lib/invoice/excel'
import { render, screen } from '@testing-library/vue'
import { expect, it } from 'vitest'
import InvoiceExportTable from '~/components/invoice/InvoiceExportTable.vue'
import { invoiceLedgerTotal, normalizeInvoiceXlsxStyleConfig } from '~/lib/invoice/excel'

it('台账导出预览区分未知金额与真实零，未知合计不冒充零', () => {
  const base = { invoiceDate: '', seller: '', invoiceType: '', projectName: '', source: '', remark: '' }
  const rows: InvoiceLedgerExportRow[] = [
    { ...base, invoiceNumber: 'UNKNOWN', totalAmount: null },
    { ...base, invoiceNumber: 'ZERO', totalAmount: 0 },
  ]
  render(InvoiceExportTable, { props: { rows, totalAmount: invoiceLedgerTotal(rows), styleConfig: normalizeInvoiceXlsxStyleConfig({}) as InvoiceResolvedStyleConfig } })
  const table = screen.getByTestId('invoice-export-preview-table')
  const lines = table.querySelectorAll('tbody tr')
  expect(lines[0]?.children[5]?.textContent?.trim()).toBe('未填写')
  expect(lines[1]?.children[5]?.textContent?.trim()).toContain('0.00')
  expect(table.querySelector('tfoot')?.textContent).toContain('未统计')
  expect(invoiceLedgerTotal([rows[1]!])).toBe(0)
})
