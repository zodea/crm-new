import type { Invoice } from '~/stores/invoice'
import { fireEvent, render, screen } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, shallowRef, useTemplateRef, watch } from 'vue'
import InvoicePrintLayout from '~/components/invoice/InvoicePrintLayout.vue'

function invoice(id: string, patch: Partial<Invoice> = {}): Invoice {
  return {
    id,
    fileName: `${id}.pdf`,
    filePath: `invoices/${id}.pdf`,
    fileSize: '1 KB',
    pageCount: 1,
    invoiceType: '增值税专用发票',
    invoiceNumber: `No-${id}`,
    invoiceDate: '2026-09-01',
    buyer: '瑞航',
    buyerTaxNo: '',
    seller: '供应商',
    sellerTaxNo: '',
    amount: 100,
    taxAmount: 13,
    totalAmount: 113,
    taxRate: '13%',
    remark: '',
    projectId: 'p',
    projectName: '项目',
    supplierId: null,
    ocrStatus: 'done',
    reviewStatus: 'reviewed',
    accountStatus: 'archived',
    dupStatus: 'normal',
    source: 'scan',
    printRotation: 0,
    ocrConfidence: null,
    confirmedAt: null,
    ownerKind: 'project',
    contractId: null,
    printCount: 0,
    archivedAt: null,
    items: [],
    fieldConfidence: {},
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
    ...patch,
  }
}

beforeEach(() => {
  for (const [name, value] of Object.entries({ computed, shallowRef, useTemplateRef, watch }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('useEventListener', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('发票打印面板的未打印提醒', () => {
  // finance-invoice.md：无原件的 Excel 发票不能加入打印范围，须明确原因。
  it('excel 导入且没有原件的票不能勾选，打印前列出未打印清单，打印只提交有原件的票', async () => {
    const scan = invoice('scan')
    const excel = invoice('excel', { source: 'excel', filePath: '', fileName: '', invoiceNumber: '26440000000000000999' })
    const view = render(InvoicePrintLayout, { props: { invoices: [scan, excel], printConfirmation: null, fullPage: true, selectedId: 'scan' } })

    expect((screen.getByRole('checkbox', { name: '勾选发票 26440000000000000999' }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByTestId('invoice-print-summary').textContent).toContain('已勾 1 张')
    expect(screen.getByTestId('invoice-print-skipped').textContent).toContain('1 张发票不会打印')
    expect(screen.getByTestId('invoice-print-skipped').textContent).toContain('26440000000000000999：Excel 导入的发票没有原件，不能打印')

    await fireEvent.click(screen.getByRole('button', { name: /打印选中/ }))
    expect(view.emitted().print?.[0]?.[0]).toMatchObject({ ids: ['scan'], totalAmount: 113 })

    await view.rerender({ invoices: [scan, excel], printConfirmation: { ids: ['scan'], rotations: { scan: 0 }, perPage: 2, pageCount: 1, totalAmount: 113 }, fullPage: true, selectedId: 'scan' })
    expect(screen.getByRole('dialog', { name: '确认打印结果' }).textContent).toContain('另有 1 张未打印')
  })

  it('全部为扫描件时不显示未打印提醒', () => {
    render(InvoicePrintLayout, { props: { invoices: [invoice('a'), invoice('b', { filePath: '' })], printConfirmation: null, fullPage: true, selectedId: 'a' } })
    expect(screen.getByTestId('invoice-print-summary').textContent).toContain('已勾 2 张')
    expect(screen.queryByTestId('invoice-print-skipped')).toBeNull()
  })
})
