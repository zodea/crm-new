import type { ExpenseClearanceProof, ExpenseClearanceSourceDTO } from '~/lib/finance/clearance-verification'
import type { OtherSettlementDraft } from '~/lib/other-settlement/contract'
import { fireEvent, render, screen } from '@testing-library/vue'
import { beforeEach, expect, it, vi } from 'vitest'
import { computed, defineComponent, ref } from 'vue'
import { clearanceBindingEdit, emptyClearanceBindingInput } from '~/components/other-settlement/clearance-binding-input'
import OtherSettlementClearanceBindingSection from '~/components/other-settlement/OtherSettlementClearanceBindingSection.vue'
import KitButton from '~/components/ui/KitButton.vue'

const proof: ExpenseClearanceProof = { schemaVersion: 'expense-clearance-verification-v1', id: 'verified-old-share', originalExpenseLineId: 'original-expense-line', headerId: 'original-expense-head', expenseVersion: '3', sourceHash: 'a'.repeat(64), workspaceId: 'current-workspace', actorId: 'real-verifier', verifiedAt: '2026-10-05T01:00:00.000Z', commandId: 'original-verification-key', basis: '原账签收与银行完整范围证实旧30尚未支付', items: [{ id: 'recognized-item', sourceClearanceLineId: 'old-clearance-line', amount: 30, matchBasis: '原账签收旧30', missingOriginalDocument: true }], originals: [{ id: 'actual-original', ownerType: 'expense_reimbursement', ownerId: 'original-expense-head', fileName: '真实交叉依据.bin', fileSize: 4, sha256: 'b'.repeat(64) }], sourceSnapshot: {} }
const source: ExpenseClearanceSourceDTO = { id: proof.originalExpenseLineId, headerId: proof.headerId, projectId: null, amount: 100, version: '3', sourceRevision: 'finance-9', clearedAmount: 30, expenseItem: '已核真实原费', serviceSupplierId: 'service-supplier', serviceSupplierNameSnapshot: '服务方', applicantWorkerId: null, applicantSupplierId: 'actual-payee', applicantNameSnapshot: '实际垫付人', clearances: [], clearanceSourceHash: proof.sourceHash, clearanceProofs: [proof], clearanceLinks: [], clearanceItemAvailability: [{ verificationId: proof.id, itemId: 'recognized-item', amountRemaining: 30 }], qualification: { state: 'verified', message: '旧30尚未付款，可明确在同一结算承接', verificationId: proof.id, recordedHandledAmount: 30, verifiedHandledAmount: 30, confirmedOtherAdoptedAmount: 0, verifiedOverlapAmount: 0, newAdoptableAmount: 70, legacyObligationAmount: 30, legacyPaidAmount: 0, legacyUnpaidAmount: 30 } }
function open(confirmed = false) {
  const draft = ref<OtherSettlementDraft>({ id: 'actual-other-head', status: confirmed ? 'confirmed' : 'draft', projectId: null, contractId: null, originalExpenses: [{ originalExpenseLineId: source.id, sourceVersion: '3', sourceRevision: 'finance-9', amount: 100 }] })
  const expenses = ref([structuredClone(source)])
  const input = ref(emptyClearanceBindingInput())
  const link = vi.fn()
  const owner = defineComponent({
    components: { OtherSettlementClearanceBindingSection },
    setup: () => ({ draft, expenses, input, confirmed, link, targets: [{ id: 'actual-adoption-line', originalExpenseLineId: source.id, amount: 100 }] }),
    template: '<OtherSettlementClearanceBindingSection v-model="input" :draft="draft" :expenses="expenses" :targets="targets" :confirmed="confirmed" :disabled="false" :unsaved="false" @patch="draft = { ...draft, ...$event }" @link="link"/>',
  })
  const nuxtLink = defineComponent({ props: ['to'], template: '<a :href="to"><slot/></a>' })
  return { draft, expenses, input, link, ...render(owner, { global: { components: { KitButton, NuxtLink: nuxtLink } } }) }
}
beforeEach(() => vi.stubGlobal('computed', computed))

it('同单明确新70加旧30为总100，原未付30与银行现金0各保原事实，不先发送超额请求', async () => {
  const f = open()
  await fireEvent.click(screen.getByRole('checkbox', { name: '承接旧份额 原账签收旧30' }))
  expect(f.draft.value.originalExpenses).toEqual([{ originalExpenseLineId: source.id, sourceVersion: '3', sourceRevision: 'finance-9', amount: 100, clearanceAllocations: [{ verificationId: proof.id, itemId: 'recognized-item', amount: 30 }] }])
  expect(screen.getByText('本次新增采用').parentElement!.textContent).toContain('70.00')
  expect(screen.getByText('承接已核旧份额').parentElement!.textContent).toContain('30.00')
  expect(screen.getByText('总采用').parentElement!.textContent).toContain('100.00')
  expect(screen.getByText('旧份额实际已付').parentElement!.textContent).toContain('0.00')
  expect(screen.getByText('原链待实付').parentElement!.textContent).toContain('30.00')
  expect(f.link).not.toHaveBeenCalled()
})

it('部分输入可明确为未知，不把未填写或无法核实银行金额显示为零', async () => {
  const f = open()
  f.expenses.value[0]!.qualification.legacyPaidAmount = null
  f.expenses.value[0]!.qualification.legacyUnpaidAmount = null
  await fireEvent.click(screen.getByRole('checkbox', { name: '承接旧份额 原账签收旧30' }))
  await fireEvent.update(screen.getByRole('spinbutton', { name: '旧份额 原账签收旧30 本次金额' }), '')
  expect(Number.isNaN(f.draft.value.originalExpenses![0]!.clearanceAllocations![0]!.amount)).toBe(true)
  expect(screen.getByText('本次新增采用').parentElement!.textContent).toContain('待核实')
  expect(screen.getByText('旧份额实际已付').parentElement!.textContent).toContain('待核实')
  expect(screen.getByText('原链待实付').parentElement!.textContent).toContain('待核实')
})

it('已确认头只选择真正采用行和真实核定item，关联空金额不冒充零，不改冻结正文', async () => {
  const f = open(true)
  await fireEvent.update(screen.getByRole('combobox', { name: '选择已核旧份额来源' }), proof.id)
  await fireEvent.click(screen.getByRole('button', { name: '新增明确关联' }))
  expect(clearanceBindingEdit(f.input.value)).toBeNull()
  await fireEvent.update(screen.getByRole('combobox', { name: '第 1 项实际采用行' }), 'actual-adoption-line')
  await fireEvent.update(screen.getByRole('combobox', { name: '第 1 项已核旧份额' }), 'recognized-item')
  await fireEvent.update(screen.getByRole('textbox', { name: '第 1 项明确重叠金额' }), '30')
  expect(clearanceBindingEdit(f.input.value)).toEqual({ verificationId: proof.id, bindings: [{ expenseAllocationId: 'actual-adoption-line', itemId: 'recognized-item', amount: 30 }] })
  await fireEvent.click(screen.getByRole('button', { name: '保存旧份额关联' }))
  expect(f.link).toHaveBeenCalledTimes(1)
  expect(f.draft.value.status).toBe('confirmed')
  expect(f.draft.value.originalExpenses![0]!.clearanceAllocations).toBeUndefined()
})

it('服务器证明已耗尽或未知的item不允许默认再次采用满额', async () => {
  const f = open()
  f.expenses.value[0]!.clearanceItemAvailability[0]!.amountRemaining = 0
  await Promise.resolve()
  const button = screen.getByRole('checkbox', { name: '承接旧份额 原账签收旧30' })
  expect(button.hasAttribute('disabled')).toBe(true)
  ;(button as HTMLInputElement).click()
  expect(f.draft.value.originalExpenses![0]!.clearanceAllocations).toBeUndefined()
})
