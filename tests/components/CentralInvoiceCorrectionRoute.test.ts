import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView, useRoute } from 'vue-router'
import CentralInvoiceCorrectionScreen from '~/components/invoice/CentralInvoiceCorrectionScreen.vue'

const mocks = vi.hoisted(() => ({ confirm: vi.fn() }))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: mocks.confirm }) }))

it('同一路由切换发票时保护未保存输入，取消停留、确认后切换', async () => {
  const makeInvoice = (id: string): CentralInvoiceRecord => ({ id, version: '1', sourceKind: 'manual', fields: { invoiceNumber: id, invoiceDate: '2026-01-01', invoiceType: '', buyer: '购方', buyerTaxNo: 'BUYER', seller: '销方', sellerTaxNo: 'SELLER', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'pending', completionMethod: 'manual', reviewStatus: 'reviewed', accountStatus: 'archived', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: 'project', projectId: 'project-one', supplierId: 'supplier-one', contract: null, archivedAt: '2026-01-01T00:00:00.000Z', original: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null })
  const client = { list: async () => [], start: async (id: string) => {
    const invoice = makeInvoice(id)
    return { invoice, baseline: { fields: invoice.fields, items: [], ownerKind: 'project', projectId: invoice.projectId, supplierId: invoice.supplierId, supplierVersion: '1', buyer: { id: 'buyer-one', version: '1' }, contract: null } }
  } }
  const session = { pending: () => null }
  const page = defineComponent({ setup() {
    const route = useRoute()
    return () => {
      const id = String(route.params.invoiceId)
      return h(CentralInvoiceCorrectionScreen, { key: id, invoiceId: id, identity: { workspaceId: 'workspace-one', actorId: 'actor-one' }, client: client as never, session: session as never, getInvoice: async () => makeInvoice(id), catalog: { projects: [], suppliers: [], contracts: [] }, signatories: [], missing: [] })
    }
  } })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/correction/:invoiceId', component: page }] })
  await router.push('/correction/invoice-one')
  await router.isReady()
  render(RouterView, { global: { plugins: [router] } })
  await screen.findByDisplayValue('invoice-one')
  await fireEvent.update(screen.getByLabelText('税额'), '6')
  mocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  await router.push('/correction/invoice-two')
  expect(router.currentRoute.value.params.invoiceId).toBe('invoice-one')
  expect(screen.getByLabelText('税额')).toHaveProperty('value', '6')
  await router.push('/correction/invoice-two')
  await waitFor(() => expect(router.currentRoute.value.params.invoiceId).toBe('invoice-two'))
  expect(mocks.confirm).toHaveBeenCalledTimes(2)
})
