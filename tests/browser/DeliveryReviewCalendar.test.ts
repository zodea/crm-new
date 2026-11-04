import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import * as Vue from 'vue'
import DeliveryDocumentFields from '~/components/delivery/DeliveryDocumentFields.vue'
import DeliveryItemsEditor from '~/components/delivery/DeliveryItemsEditor.vue'
import DeliveryReviewPanel from '~/components/delivery/DeliveryReviewPanel.vue'
import { deliveryReviewIssueDetails, editDeliveryAmountLine, summarizeDeliveryAmounts } from '~/lib/delivery/review'

afterEach(() => vi.unstubAllGlobals())

it('送货审核提示无效日历日期和数量，修正后才允许归档', async () => {
  for (const [name, api] of Object.entries({ computed: Vue.computed, shallowRef: Vue.shallowRef, watch: Vue.watch })) vi.stubGlobal(name, api)
  const draft = Vue.ref({ projectId: 'project-one', supplierId: 'supplier-one', orderNo: 'D-1', deliveryDate: '2025-02-29', docType: '送货单', siteText: '', note: '', items: [{ id: 'line-one', name: '电线', spec: '', unit: '米', qty: 1, unitPrice: null, amount: null, amountSource: 'manual' as const, note: '' }], confirmations: { humanReviewed: true } })
  const file = { id: 'file-one', name: '合成.png', intakeDecision: 'material', ocrStatus: 'done', printDisposition: 'pending', supplierText: '' }
  const document = { id: 'document-one', note: '', quality: 'normal', statedTotal: null, supplierText: '' }
  await render(Vue.defineComponent({ setup: () => () => {
    const issues = deliveryReviewIssueDetails(draft.value)
    return Vue.h('main', { style: { height: '850px', minWidth: '0' } }, Vue.h(DeliveryReviewPanel, {
      draft: draft.value,
      file,
      document,
      documents: [document],
      projects: [{ id: 'project-one', name: '合成项目' }],
      suppliers: [{ id: 'supplier-one', name: '合成分供方' }],
      supplierSuggestion: null,
      amountSummary: summarizeDeliveryAmounts(draft.value.items, null),
      reviewIssues: issues,
      reviewProgress: { passed: 6 - issues.length, total: 6 },
      canArchive: issues.length === 0,
      queueStatus: { label: '待归档', cls: '' },
      saving: false,
      onPatchDraft: patch => draft.value = { ...draft.value, ...patch },
      onEditItemAmount: (index, field, value) => {
        const items = [...draft.value.items]
        items[index] = editDeliveryAmountLine(items[index]!, field, value)
        draft.value = { ...draft.value, items }
      },
    }))
  } }), { global: { components: { DeliveryDocumentFields, DeliveryItemsEditor, NuxtLink: Vue.defineComponent({ template: '<a><slot /></a>' }) } } })
  const archive = page.getByRole('button', { name: '确认人工归档' })
  await expect.element(archive).toBeDisabled()
  await expect.element(page.getByText('送货日期无效，必须依据原件人工核对')).toBeVisible()
  const date = window.document.querySelector<HTMLInputElement>('input[type="date"]')!
  date.value = '2024-02-29'
  date.dispatchEvent(new Event('input', { bubbles: true }))
  await expect.element(archive).toBeEnabled()
  draft.value = { ...draft.value, items: [{ ...draft.value.items[0]!, qty: Number.POSITIVE_INFINITY }] }
  await expect.element(page.getByText('每条明细必须人工确认材料名称、单位和非零数量')).toBeVisible()
  await expect.element(archive).toBeDisabled()
  draft.value = { ...draft.value, items: [{ ...draft.value.items[0]!, qty: 1 }] }
  await expect.element(archive).toBeEnabled()
  expect(window.document.documentElement.scrollWidth).toBeLessThanOrEqual(window.document.documentElement.clientWidth + 1)
})
