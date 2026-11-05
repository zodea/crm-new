import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { fireEvent, render, screen } from '@testing-library/vue'
import { expect, it } from 'vitest'
import CentralInvoiceFieldsForm from '~/components/invoice/CentralInvoiceFieldsForm.vue'

function invoice(): CentralInvoiceRecord {
  return {
    id: 'invoice-one',
    version: '1',
    sourceKind: 'scan',
    fields: { invoiceNumber: '00123456', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'done',
    completionMethod: 'ocr',
    reviewStatus: 'unreviewed',
    accountStatus: 'none',
    duplicateStatus: 'normal',
    printCount: 0,
    printRotation: 0,
    ownerKind: null,
    projectId: null,
    supplierId: null,
    contract: null,
    archivedAt: null,
    original: { id: 'original-one', fileName: '合成.pdf', fileSize: 100, mimeType: 'application/pdf', sha256: 'a'.repeat(64) },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
}

it('留空与明确零分别显示并保存；版本变化时保留未保存输入', async () => {
  const current = invoice()
  const view = render(CentralInvoiceFieldsForm, { props: { record: current } })
  expect((screen.getByLabelText('不含税金额') as HTMLInputElement).value).toBe('')
  expect((screen.getByLabelText('税额') as HTMLInputElement).value).toBe('0')
  await fireEvent.update(screen.getByLabelText('不含税金额'), '0')
  await fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
  expect(view.emitted('save')?.[0]?.[0]).toMatchObject({ invoiceId: current.id, baseVersion: '1', fields: { amount: 0, taxAmount: 0, totalAmount: null } })
  await view.rerender({ record: { ...current, version: '2', fields: { ...current.fields, amount: 20 } } })
  expect(screen.getByRole('alert').textContent).toContain('其他位置已更新')
  expect((screen.getByLabelText('不含税金额') as HTMLInputElement).value).toBe('0')
  expect((screen.getByRole('button', { name: '保存修改' }) as HTMLButtonElement).disabled).toBe(true)
})

it('保存后回读相同内容清除草稿状态，可以继续人工核对', async () => {
  const current = invoice()
  const view = render(CentralInvoiceFieldsForm, { props: { record: current } })
  await fireEvent.update(screen.getByLabelText('不含税金额'), '0')
  await view.rerender({ record: { ...current, version: '2', fields: { ...current.fields, amount: 0 } } })
  expect(screen.queryByRole('alert')).toBeNull()
  expect((screen.getByRole('button', { name: '确认已核对' }) as HTMLButtonElement).disabled).toBe(false)
  await fireEvent.click(screen.getByRole('button', { name: '确认已核对' }))
  expect(view.emitted('review')).toEqual([[false]])
})

it('重新识别草稿标出变化、原值和后续人工修改', async () => {
  const baseline = invoice()
  const candidate = { ...baseline, fields: { ...baseline.fields, amount: 100 } }
  render(CentralInvoiceFieldsForm, { props: { record: candidate, baseline, lockActions: true } })
  expect(screen.getByText('识别变动（原值：未填写）')).toBeTruthy()
  await fireEvent.update(screen.getByLabelText(/不含税金额/), '120')
  expect(screen.getByText('已人工修改（原值：未填写）')).toBeTruthy()
  expect((screen.getByRole('button', { name: '确认已核对' }) as HTMLButtonElement).disabled).toBe(true)
})
