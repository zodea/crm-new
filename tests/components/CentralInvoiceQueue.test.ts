import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { expect, it } from 'vitest'
import CentralInvoiceQueue from '~/components/invoice/CentralInvoiceQueue.vue'

it('队列区分未知金额和零，并将所选文件与发票身份交给上层', async () => {
  const records = [
    { id: 'invoice-one', fields: { invoiceNumber: '00001', totalAmount: null }, original: null, ocrStatus: 'pending', printCount: 0, reviewStatus: 'unreviewed', accountStatus: 'none' },
    { id: 'invoice-two', fields: { invoiceNumber: '00002', totalAmount: 0 }, original: null, ocrStatus: 'done', printCount: 0, reviewStatus: 'reviewed', accountStatus: 'archived' },
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

it('队列显示已保存的识别与打印状态，不将未完成误称识别中', async () => {
  const records = [
    { id: 'waiting', fields: { invoiceNumber: '待识别', totalAmount: null }, ocrStatus: 'pending', printCount: 0, reviewStatus: 'unreviewed', accountStatus: 'none' },
    { id: 'partial', fields: { invoiceNumber: '部分识别', totalAmount: null }, ocrStatus: 'failed', printCount: 0, reviewStatus: 'unreviewed', accountStatus: 'none' },
    { id: 'completed', fields: { invoiceNumber: '识别完成的票', totalAmount: 50 }, ocrStatus: 'done', printCount: 2, reviewStatus: 'reviewed', accountStatus: 'archived' },
    { id: 'manual', fields: { invoiceNumber: '人工补全的票', totalAmount: 10 }, ocrStatus: 'pending', printCount: 0, reviewStatus: 'reviewed', accountStatus: 'archived' },
  ] as CentralInvoiceRecord[]
  const view = render(CentralInvoiceQueue, { props: { records, selectedId: null, projects: [] } })

  const waiting = screen.getByRole('button', { name: /待识别/ })
  expect(within(waiting).getByText('识别尚未完成')).toBeTruthy()
  expect(within(waiting).queryByText(/识别中/)).toBeNull()
  expect(within(screen.getByRole('button', { name: /部分识别/ })).getByText('识别失败或部分页面未识别')).toBeTruthy()
  const completed = screen.getByRole('button', { name: /识别完成的票/ })
  expect(within(completed).getByText('识别完成')).toBeTruthy()
  expect(within(completed).getByText('已登记打印 2 次')).toBeTruthy()
  const manual = screen.getByRole('button', { name: /人工补全的票/ })
  expect(within(manual).getByText('识别尚未完成')).toBeTruthy()
  expect(within(manual).getByText('已核对 · 已归档')).toBeTruthy()
  expect(within(manual).getByText('未登记打印')).toBeTruthy()
  await view.rerender({ recognizingId: 'waiting' })
  const progress = within(waiting).getByText('正在识别或核对结果')
  expect(progress.getAttribute('aria-live')).toBe('polite')
  expect(within(manual).getByText('识别尚未完成')).toBeTruthy()
  await view.rerender({ recognizingId: null })
  expect(within(waiting).getByText('识别尚未完成')).toBeTruthy()
})
