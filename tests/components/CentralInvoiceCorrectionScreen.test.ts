import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import type { InvoiceCorrectionDraft, InvoiceCorrectionSaveCommand } from '~/lib/invoice/correction-contract'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import CentralInvoiceCorrectionScreen from '~/components/invoice/CentralInvoiceCorrectionScreen.vue'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {}, onBeforeRouteUpdate: () => {} }))

it('票面先应用并保存草稿，再明确提交；来源缺失时不能提交', async () => {
  const invoice: CentralInvoiceRecord = { id: 'invoice-one', version: '1', sourceKind: 'manual', fields: { invoiceNumber: '10001', invoiceDate: '2026-01-01', invoiceType: '', buyer: '购方', buyerTaxNo: 'BUYER', seller: '销方', sellerTaxNo: 'SELLER', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'pending', completionMethod: 'manual', reviewStatus: 'reviewed', accountStatus: 'archived', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: 'project', projectId: 'project-one', supplierId: 'supplier-one', contract: null, archivedAt: '2026-01-01T00:00:00.000Z', original: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
  const baseline = { fields: invoice.fields, items: [], ownerKind: 'project' as const, projectId: 'project-one', supplierId: 'supplier-one', supplierVersion: '1', buyer: { id: 'buyer-one', version: '1' }, contract: null }
  let saved: InvoiceCorrectionDraft | null = null
  const client = { start: vi.fn(async () => ({ invoice, baseline })), list: vi.fn(async () => saved ? [saved] : []), get: vi.fn(async () => saved!), history: vi.fn(async () => []) }
  const session = { pending: () => null, execute: vi.fn(async (command: InvoiceCorrectionSaveCommand | { action: 'submit' }) => {
    if (command.action === 'save-draft') {
      saved = { id: 'correction-one', invoiceId: invoice.id, baseInvoiceVersion: invoice.version, version: '1', state: 'draft', baseline, proposed: command.proposed, reason: command.reason, attachments: [], createdAt: invoice.createdAt, updatedAt: invoice.updatedAt, submittedAt: null, resultInvoiceVersion: null }
    }
    else {
      saved = { ...saved!, state: 'submitted', version: '2', submittedAt: invoice.updatedAt, resultInvoiceVersion: '2' }
    }
    return { correction: saved }
  }), recover: vi.fn() }
  const props = { invoiceId: invoice.id, identity: { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'finance-invoice:write'] }, client: client as never, session: session as never, getInvoice: async () => invoice, catalog: { projects: [{ id: 'project-one', label: '项目', version: '1', sourceVersion: 'projects:1' }], suppliers: [{ id: 'supplier-one', label: '销方', version: '1', sourceVersion: 'suppliers:1' }], contracts: [] }, signatories: [{ id: 'buyer-one', label: '购方', version: '1' }], missing: [] as string[] }
  const rendered = render(CentralInvoiceCorrectionScreen, { props })
  await screen.findByLabelText('税额')
  expect(screen.getByText('原票没有可读取的原件，请结合现有资料核对。')).toBeTruthy()
  await fireEvent.update(screen.getByLabelText('税额'), '3')
  expect((screen.getByRole('button', { name: '保存草稿' }) as HTMLButtonElement).disabled).toBe(true)
  await fireEvent.click(screen.getByRole('button', { name: '应用票面修改' }))
  await fireEvent.update(screen.getByLabelText('更正原因'), '核对税额')
  expect(screen.getByText(/税额：0 → 3/)).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
  await waitFor(() => expect(screen.getByText('更正草稿已保存；原发票尚未改变。')).toBeTruthy())
  expect(session.execute).toHaveBeenCalledTimes(1)
  expect(session.execute.mock.calls[0]![0]).not.toHaveProperty('capabilities')
  await rendered.rerender({ ...props, missing: ['suppliers'] })
  expect((screen.getByRole('button', { name: '确认提交更正' }) as HTMLButtonElement).disabled).toBe(true)
  await rendered.rerender(props)
  await fireEvent.click(screen.getByRole('button', { name: '确认提交更正' }))
  await waitFor(() => expect(screen.getByText('更正已提交并重新读取。')).toBeTruthy())
  expect(session.execute).toHaveBeenCalledTimes(2)
  expect(session.execute.mock.calls[1]![0]).not.toHaveProperty('capabilities')
})

it('服务端拒绝已打印原票时向用户显示人工核对原因', async () => {
  const invoice = { id: 'invoice-print', version: '2', fields: { invoiceNumber: 'PRINT-1' }, original: null } as CentralInvoiceRecord
  const problem = { code: 'conflict', message: '发票已有打印历史，请先人工核对。', retryable: false, fieldErrors: {}, traceId: null }
  const client = { list: vi.fn(async () => []), start: vi.fn(async () => {
    throw Object.assign(new Error('HTTP 409'), { response: { status: 409, _data: { data: problem } } })
  }) }
  const session = { pending: () => null }
  render(CentralInvoiceCorrectionScreen, { props: { invoiceId: invoice.id, identity: { workspaceId: 'workspace-one', actorId: 'actor-one' }, client: client as never, session: session as never, getInvoice: async () => invoice, catalog: { projects: [], suppliers: [], contracts: [] }, signatories: [], missing: [] } })
  expect((await screen.findByRole('alert')).textContent).toContain('发票已有打印历史，请先人工核对。')
})

it('重新授权时若原提交可能已生效，仅展示原编号核对，恢复后重新读取', async () => {
  const invoice = { id: 'invoice-pending', version: '1', sourceKind: 'manual', fields: { invoiceNumber: 'PENDING-1', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'pending', completionMethod: 'manual', reviewStatus: 'reviewed', accountStatus: 'archived', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: 'project', projectId: 'project-one', supplierId: 'supplier-one', contract: null, archivedAt: '2026-01-01T00:00:00.000Z', original: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null } as CentralInvoiceRecord
  const baseline = { fields: invoice.fields, items: [], ownerKind: 'project' as const, projectId: 'project-one', supplierId: 'supplier-one', supplierVersion: '1', buyer: { id: 'buyer-one', version: '1' }, contract: null }
  let pending: object | null = null
  let applied = false
  let current = invoice
  const saved = { id: 'correction-one', invoiceId: invoice.id, baseInvoiceVersion: '1', version: '1', state: 'draft', baseline, proposed: { ...baseline, fields: { ...baseline.fields, taxAmount: 3 } }, reason: '核对税额', attachments: [], createdAt: invoice.createdAt, updatedAt: invoice.updatedAt, submittedAt: null, resultInvoiceVersion: null } as InvoiceCorrectionDraft
  const session = {
    pending: () => pending,
    execute: async () => {
      pending = { commandId: 'original-command' }
      throw new Error('连接中断')
    },
    recover: async () => {
      pending = null
      applied = true
      return { outcome: 'applied', correction: saved }
    },
  }
  const client = { list: async () => applied ? [saved] : [], start: async () => ({ invoice, baseline }), history: async () => [] }
  const wrapper = mount(CentralInvoiceCorrectionScreen, { attachTo: document.body, props: { invoiceId: invoice.id, identity: { workspaceId: 'workspace-one', actorId: 'actor-one' }, client: client as never, session: session as never, getInvoice: async () => current, catalog: { projects: [], suppliers: [], contracts: [] }, signatories: [], missing: [] } })
  try {
    await flushPromises()
    await fireEvent.update(screen.getByLabelText('税额'), '3')
    await fireEvent.click(screen.getByRole('button', { name: '应用票面修改' }))
    await fireEvent.update(screen.getByLabelText('更正原因'), '核对税额')
    await fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await screen.findByText('原提交结果尚待核对。')
    current = { ...invoice, version: '2' }
    await (wrapper.vm as unknown as { revalidate: (getInvoice: () => Promise<CentralInvoiceRecord>, client: never) => Promise<void> }).revalidate(async () => current, client as never)
    await waitFor(() => expect(screen.queryByRole('heading', { name: '发票更正单' })).toBeNull())
    expect(screen.getByRole('button', { name: '核对原提交' })).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: '核对原提交' }))
    await screen.findByText('原提交已核对；原票版本已变化，当前输入仍保留，请先人工核对。')
    expect(screen.queryByRole('heading', { name: '发票更正单' })).toBeNull()
  }
  finally { wrapper.unmount() }
})
