import type { PaymentVerificationInput, PaymentVerificationState } from '~/lib/finance/payment-verification'
import { fireEvent, render, screen } from '@testing-library/vue'
import { beforeEach, expect, it, vi } from 'vitest'
import { computed, defineComponent, ref } from 'vue'
import FinancePaymentVerificationSection from '~/components/finance/FinancePaymentVerificationSection.vue'
import KitButton from '~/components/ui/KitButton.vue'

const original = { id: 'payment-original', ownerType: 'payment_application', ownerId: 'payment-application', fileName: '真实原件.bin', filePath: '', fileSize: 4, mimeType: 'application/octet-stream', category: '业务附件', uploader: '原上传人', uploadedAt: '2026-10-05T00:00:00.000Z', deletedAt: null, sha256: 'a'.repeat(64) }
const missing = { ...original, id: 'metadata-only-file', fileName: '历史缺件.bin', fileSize: 7, sha256: null }
const blank = (): PaymentVerificationInput => ({ actualDueAmount: '', cumulativePayableAmount: '', basis: '', fileIds: [] })
const state: PaymentVerificationState = { required: true, status: 'missing', message: '请先核实真实原费用与已确认结算', proof: null }
function open(props: { disabled?: boolean, unsaved?: boolean, state?: PaymentVerificationState } = {}) {
  const input = ref(blank())
  const verify = vi.fn()
  const owner = defineComponent({
    components: { FinancePaymentVerificationSection },
    setup: () => ({ input, verify, original, missing, state, props }),
    template: '<FinancePaymentVerificationSection v-model="input" :state="props.state ?? state" :attachments="[original, missing]" :disabled="props.disabled ?? false" :unsaved="props.unsaved ?? false" @verify="verify" />',
  })
  const rendered = render(owner, { global: { components: { KitButton } } })
  return { input, verify, ...rendered }
}
beforeEach(() => vi.stubGlobal('computed', computed))

it('两项累计结论保留空和真实零输入，真实依据可选择而历史缺件不伪作正文', async () => {
  const f = open()
  expect(screen.getByRole('region', { name: '历史付款业务核验' }).textContent).toContain('本次银行实付继续在支付记录填写')
  expect(f.input.value).toEqual(blank())
  expect(screen.queryByRole('checkbox', { name: '核验依据 历史缺件.bin' })).toBeNull()
  const actualDue = screen.getByRole('textbox', { name: '核实累计应付金额' })
  const cap = screen.getByRole('textbox', { name: '核实累计可付金额' })
  await fireEvent.update(actualDue, '70')
  await fireEvent.update(cap, '0')
  await fireEvent.update(screen.getByRole('textbox', { name: '业务核验依据' }), '核验累计结论，不把本次30元作为累计70元')
  await fireEvent.click(screen.getByRole('checkbox', { name: '核验依据 真实原件.bin' }))
  expect(f.input.value).toEqual({ actualDueAmount: '70', cumulativePayableAmount: '0', basis: '核验累计结论，不把本次30元作为累计70元', fileIds: ['payment-original'] })
  await fireEvent.click(screen.getByRole('button', { name: '保存业务核验' }))
  expect(f.verify).toHaveBeenCalledTimes(1)
  await fireEvent.update(cap, '')
  expect(f.input.value.cumulativePayableAmount).toBe('')
})

it.each([{ unsaved: true }, { disabled: true }])('申请或原件未保存/权限不可用时不能保存核验：%j', async (props) => {
  const f = open(props)
  const save = screen.getByRole('button', { name: '保存业务核验' })
  expect(save.hasAttribute('disabled')).toBe(true)
  ;(save as HTMLButtonElement).click()
  expect(f.verify).not.toHaveBeenCalled()
  if (props.unsaved)
    expect(screen.getByText('请先保存申请编辑和依据原件，再核验已保存版本。')).toBeTruthy()
  if (props.disabled)
    expect(screen.getByRole('textbox', { name: '业务核验依据' }).hasAttribute('disabled')).toBe(true)
})

it('冻结结论、核验人及时间明确展示，源状态缺口不被显示为零或可确认', () => {
  open({ state: { required: true, status: 'unavailable', message: '公司费用合同真实来源尚未接通，回单仍可存草稿', proof: null } })
  expect(screen.getByRole('status').textContent).toContain('真实来源尚未接通')
  expect(screen.queryByRole('definition', { name: '已冻结业务核验' })).toBeNull()
  expect(screen.queryByText('核验人')).toBeNull()
})
