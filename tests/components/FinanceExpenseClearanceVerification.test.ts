import type { ExpenseClearanceSourceDTO, ExpenseClearanceVerificationState } from '~/lib/finance/clearance-verification'
import { fireEvent, render, screen } from '@testing-library/vue'
import { beforeEach, expect, it, vi } from 'vitest'
import { computed, defineComponent, nextTick, ref } from 'vue'
import { emptyExpenseClearanceInput, expenseClearanceEdit } from '~/components/finance/expense-clearance-input'
import FinanceExpenseClearanceVerificationSection from '~/components/finance/FinanceExpenseClearanceVerificationSection.vue'
import KitButton from '~/components/ui/KitButton.vue'

const original = { id: 'replacement-original', ownerType: 'expense_reimbursement', ownerId: 'original-expense-head', fileName: '银行与签收交叉依据.bin', filePath: '', fileSize: 4, mimeType: 'application/octet-stream', category: '业务附件', uploader: '原上传人', uploadedAt: '2026-10-05T00:00:00.000Z', deletedAt: null, sha256: 'a'.repeat(64) }
const source: ExpenseClearanceSourceDTO = {
  id: 'original-expense-line',
  headerId: original.ownerId,
  projectId: null,
  amount: 100,
  version: '3',
  sourceRevision: 'finance-9',
  clearedAmount: 30,
  expenseItem: '真实原费用',
  serviceSupplierId: 'service-supplier',
  serviceSupplierNameSnapshot: '真实服务方',
  applicantWorkerId: null,
  applicantSupplierId: 'actual-payee',
  applicantNameSnapshot: '实际垫付人',
  clearances: [{ id: 'original-clearance-line', headerId: 'original-clearance-head', originalExpenseLineId: 'original-expense-line', amount: 30, status: 'confirmed', deletedAt: null, headerDeletedAt: null, sourceVersion: '2', missingOriginalDocument: true, originalDocumentState: 'missing-body' }],
  clearanceSourceHash: 'b'.repeat(64),
  clearanceProofs: [],
  clearanceLinks: [],
  clearanceItemAvailability: [],
  qualification: { state: 'missing', message: '旧处理份额需替代核验，银行支付归属尚待核实', verificationId: null, recordedHandledAmount: 30, verifiedHandledAmount: null, confirmedOtherAdoptedAmount: 0, verifiedOverlapAmount: null, newAdoptableAmount: null, legacyObligationAmount: 30, legacyPaidAmount: null, legacyUnpaidAmount: null },
}
function open(options: { disabled?: boolean, unsaved?: boolean } = {}) {
  const input = ref(emptyExpenseClearanceInput())
  const state = ref<ExpenseClearanceVerificationState>({ status: 'missing', message: '保全原费用及遗失原单状态', sources: [structuredClone(source)], proofs: [] })
  const verify = vi.fn()
  const owner = defineComponent({
    components: { FinanceExpenseClearanceVerificationSection },
    setup: () => ({ input, state, verify, options, originals: [original, { ...original, id: 'missing-file', fileName: '遗失原单.bin', sha256: null }, { ...original, id: 'foreign-file', fileName: '另一申请原件.bin', ownerType: 'payment_application' }] }),
    template: '<FinanceExpenseClearanceVerificationSection v-model="input" :state="state" :attachments="originals" :disabled="options.disabled ?? false" :unsaved="options.unsaved ?? false" @verify="verify" />',
  })
  return { input, state, verify, ...render(owner, { global: { components: { KitButton } } }) }
}
beforeEach(() => vi.stubGlobal('computed', computed))
async function select() {
  await fireEvent.update(screen.getByRole('combobox', { name: '选择原费用行' }), source.id)
}

it('真实费用与旧30保全，未知银行份额不变成已付0，原件缺失不因替代件出现而消失', async () => {
  open()
  await select()
  const summary = screen.getByText('旧份额已付').parentElement!
  expect(summary.textContent).toContain('待核实')
  expect(screen.getByText('可新增采用额度').parentElement!.textContent).toContain('待核实')
  expect(screen.getByText('旧记录处理份额').parentElement!.textContent).toContain('30.00')
  expect(screen.getByText('原清偿单缺失状态保留，替代证据不表示原件已找回。')).toBeTruthy()
  expect(screen.queryByRole('checkbox', { name: '替代证据 遗失原单.bin' })).toBeNull()
  expect(screen.queryByRole('checkbox', { name: '替代证据 另一申请原件.bin' })).toBeNull()
})

it('逐条明确选择真实旧记录并核定匹配份额，空金额不默认零且来源版本冻结在选择时', async () => {
  const f = open()
  await select()
  await fireEvent.click(screen.getByRole('button', { name: '新增核定份额' }))
  expect(f.input.value.items[0]!.amount).toBe('')
  expect(expenseClearanceEdit(f.input.value)).toBeNull()
  await fireEvent.update(screen.getByRole('combobox', { name: '第 1 项份额来源' }), 'original-clearance-line')
  await fireEvent.update(screen.getByRole('textbox', { name: '第 1 项核定处理金额' }), '30')
  await fireEvent.update(screen.getByRole('textbox', { name: '第 1 项原费用匹配依据' }), '签收行与原费用ID交叉核实，银行单不能替代此匹配')
  await fireEvent.update(screen.getByRole('textbox', { name: '替代核验说明' }), '原单缺失，银行与签收共同核对')
  await fireEvent.click(screen.getByRole('checkbox', { name: '替代证据 银行与签收交叉依据.bin' }))
  expect(expenseClearanceEdit(f.input.value)).toEqual({ originalExpenseLineId: source.id, sourceVersion: '3', sourceHash: 'b'.repeat(64), basis: '原单缺失，银行与签收共同核对', fileIds: [original.id], items: [{ sourceClearanceLineId: 'original-clearance-line', amount: 30, matchBasis: '签收行与原费用ID交叉核实，银行单不能替代此匹配' }], existingBindings: [] })
  f.state.value.sources[0]!.version = '4'
  expect(f.input.value.sourceVersion).toBe('3')
  expect(f.input.value.sourceHash).toBe('b'.repeat(64))
  await fireEvent.click(screen.getByRole('button', { name: '保存旧清偿替代核验' }))
  expect(f.verify).toHaveBeenCalledTimes(1)
})

it.each([{ unsaved: true }, { disabled: true }])('普通编辑或原件未保存/失权时阻断核验，私有输入仍保留%j', async (options) => {
  const f = open(options)
  if (options.disabled)
    f.input.value = { ...emptyExpenseClearanceInput(), originalExpenseLineId: source.id }
  else await select()
  await nextTick()
  const button = screen.getByRole('button', { name: '保存旧清偿替代核验' })
  expect(button.hasAttribute('disabled')).toBe(true)
  ;(button as HTMLButtonElement).click()
  expect(f.verify).not.toHaveBeenCalled()
})
