import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { fireEvent, render, screen } from '@testing-library/vue'
import { expect, it } from 'vitest'
import CentralInvoiceQueue from '~/components/invoice/CentralInvoiceQueue.vue'

it('队列区分未知金额和零，并将所选文件与发票身份交给上层', async () => {
  const records = [
    { id: 'invoice-one', fields: { invoiceNumber: '00001', totalAmount: null }, original: null, reviewStatus: 'unreviewed', accountStatus: 'none' },
    { id: 'invoice-two', fields: { invoiceNumber: '00002', totalAmount: 0 }, original: null, reviewStatus: 'reviewed', accountStatus: 'archived' },
  ] as CentralInvoiceRecord[]
  const view = render(CentralInvoiceQueue, { props: { records, selectedId: null, projects: [{ id: 'project-one', label: '合成项目' }] } })
  expect(screen.getByText('价税合计未填写')).toBeTruthy()
  expect(screen.getByText('价税合计 0')).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: /00002/ }))
  expect(view.emitted('select')).toEqual([['invoice-two']])
  const file = new File(['%PDF-1.4'], '合成.pdf', { type: 'application/pdf' })
  expect((screen.getByLabelText('上传发票') as HTMLInputElement).disabled).toBe(true)
  await fireEvent.update(screen.getByLabelText('上传项目'), 'project-one')
  await fireEvent.change(screen.getByLabelText('上传发票'), { target: { files: [file] } })
  expect(view.emitted('upload')).toEqual([[[file], 'project-one']])
})
