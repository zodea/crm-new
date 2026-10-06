<script setup lang="ts">
import type { FinancePageDraft } from '~/lib/finance/page'
import type { LookupOption } from '~/lib/kit/lookup'
import { computed, shallowRef, watch } from 'vue'
import { approvalAmountLabel, readApprovalAmount } from '~/lib/finance/approval-amount'
import { needsSettlementAllocation, PAYMENT_BIZ_TYPES } from '~/lib/finance/domain'
import { financeDraftMoney, financeInputNumber as inputNumber } from '~/lib/finance/input-number'
import FinanceLineGrid from './FinanceLineGrid.vue'

const props = defineProps<{
  kind: 'payment_application' | 'payment_record'
  draft: FinancePageDraft
  fieldErrors?: Record<string, string>
  fetchProjects: (keyword: string) => Promise<LookupOption[]>
  fetchSuppliers: (keyword: string) => Promise<LookupOption[]>
  fetchWorkers?: (keyword: string) => Promise<LookupOption[]>
  fetchExpenseContracts: (keyword: string) => Promise<LookupOption[]>
  fetchSettlements: (keyword: string) => Promise<LookupOption[]>
  fetchInvoices: (keyword: string) => Promise<LookupOption[]>
  fetchPaymentApplications: (keyword: string) => Promise<LookupOption[]>
}>()

const emit = defineEmits<{
  patch: [patch: Partial<FinancePageDraft>]
  clearError: [field: string]
}>()

function options(values: string[]) {
  return values.map(value => ({ key: value, label: value }))
}

const PAYMENT_METHOD_OPTIONS = options(['银行转账', '承兑汇票', '现金', '其他'])
const BIZ_TYPE_OPTIONS = options([...PAYMENT_BIZ_TYPES])
const PAYEE_OPTIONS = [{ key: 'supplier', label: '分供方' }, { key: 'worker', label: '工人垫款清偿' }]
const payeeKind = shallowRef<'worker' | 'supplier'>(props.draft.workerId ? 'worker' : 'supplier')
watch(() => [props.kind, props.draft.id, props.draft.workerId, props.draft.supplierId] as const, (value, previous) => {
  if (value[0] !== previous[0] || value[1] !== previous[1] || value[2] || value[3])
    payeeKind.value = value[2] ? 'worker' : 'supplier'
})
const payeeLabels = new Map<string, string>()
async function fetchPayees(keyword: string) {
  const scope = `${props.kind}:${props.draft.id ?? 'new'}:${payeeKind.value}`
  const fetch = payeeKind.value === 'worker' ? props.fetchWorkers : props.fetchSuppliers
  if (!fetch)
    throw new Error('全局工人来源尚未可靠读取')
  const rows = await fetch(keyword)
  if (scope !== `${props.kind}:${props.draft.id ?? 'new'}:${payeeKind.value}`)
    throw new DOMException('实际收款对象范围已变化。', 'AbortError')
  payeeLabels.clear()
  rows.forEach(row => payeeLabels.set(row.id, row.label))
  return rows
}
function choosePayeeKind(value: string | undefined) {
  payeeKind.value = value === 'worker' ? 'worker' : 'supplier'
  payeeLabels.clear()
  emit('patch', { supplierId: null, workerId: null, payeeNameSnapshot: null, contractId: null, settlementAllocations: [], invoiceAllocations: [], applicationAllocations: [] })
}
function choosePayee(value: string | null | undefined) {
  const id = value || null
  const name = id ? payeeLabels.get(id) : undefined
  emit('patch', { supplierId: payeeKind.value === 'supplier' ? id : null, workerId: payeeKind.value === 'worker' ? id : null, payeeNameSnapshot: null, ...(props.kind === 'payment_record' ? { payeeName: name ?? '' } : {}), contractId: null, settlementAllocations: [], invoiceAllocations: [], applicationAllocations: [] })
  emit('clearError', 'supplierId')
}
const COST_OPTIONS = options(['合同劳务', '专业分包', '材料', '机械', '管理费', '项目费用', '其他'])
const INVOICE_STATE_OPTIONS = options(['先票后款', '先款后票', '无需发票'])
const SOURCE_OPTIONS = [
  { key: 'manual', label: '手工录入' },
  { key: 'image_ocr', label: '图片/PDF 识别' },
  { key: 'excel_import', label: 'Excel 导入' },
]

const isCompanyPayment = computed(() =>
  props.kind === 'payment_application' && props.draft.bizType === '公司付款',
)
const showsContract = computed(() =>
  props.kind === 'payment_application'
  && (props.draft.bizType?.startsWith('有合同-') || props.draft.bizType === '预付款'),
)
const showsSettlements = computed(() =>
  props.kind === 'payment_application'
  && (needsSettlementAllocation(props.draft.bizType ?? '') || props.draft.bizType === '公司付款'),
)
const showsInvoices = computed(() =>
  props.kind === 'payment_application' && props.draft.invoiceState !== '无需发票',
)
const settlementTotal = computed(() =>
  (props.draft.settlementAllocations ?? [])
    .reduce((sum, line) => sum + Number(line.allocatedAmount), 0),
)
const invoiceTotal = computed(() =>
  (props.draft.invoiceAllocations ?? [])
    .reduce((sum, line) => sum + Number(line.allocatedAmount), 0),
)
const paymentAllocationTotal = computed(() =>
  (props.draft.applicationAllocations ?? [])
    .reduce((sum, line) => sum + Number(line.allocatedAmount), 0),
)
const applyAmount = computed(() => props.draft.applyAmount == null ? Number.NaN : Number(props.draft.applyAmount))
const paymentAmount = computed(() => props.draft.amount == null ? Number.NaN : Number(props.draft.amount))
const approvalHint = computed(() => {
  const amount = props.draft.approvedAmount ?? null
  if (amount !== null && (!Number.isFinite(amount) || amount < 0))
    return '请输入非负有效金额'
  return approvalAmountLabel(readApprovalAmount(amount, props.draft.approvedAmountEdit ? 'user-entry' : props.draft.approvedAmountOrigin).state)
})

function inputApproval(event: Event) {
  const input = event.target as HTMLInputElement
  const value = input.value.trim()
  const amount = input.validity.badInput ? Number.NaN : value === '' ? null : Number(value)
  emit('patch', { approvedAmount: amount, approvedAmountEdit: { value: amount } })
  emit('clearError', 'approvedAmount')
}

function patch(field: keyof FinancePageDraft, value: unknown) {
  const next = { [field]: value } as Partial<FinancePageDraft>
  if (field === 'projectId' && props.kind === 'payment_application') {
    Object.assign(next, {
      contractId: null,
      settlementAllocations: [],
      invoiceAllocations: [],
    })
  }
  if (field === 'supplierId' && props.kind === 'payment_application')
    Object.assign(next, { contractId: null, invoiceAllocations: [] })
  if (field === 'contractId' && props.kind === 'payment_application')
    Object.assign(next, { settlementAllocations: [] })
  if (field === 'bizType' && value === '公司付款')
    Object.assign(next, { projectId: null, contractId: null, settlementAllocations: [] })
  if (field === 'invoiceState' && value === '无需发票')
    Object.assign(next, { invoiceAllocations: [] })
  emit('patch', next)
  emit('clearError', String(field))
}

function updateGrid(field: keyof FinancePageDraft, lines: unknown[]) {
  emit('patch', { [field]: lines } as Partial<FinancePageDraft>)
  emit('clearError', String(field))
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}

function jsonValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2)
}

function fieldClass(field: string) {
  return props.fieldErrors?.[field] ? 'border-danger! ring-1 ring-danger/20' : ''
}
</script>

<template>
  <template v-if="kind === 'payment_application'">
    <section id="section-basic" class="panel scroll-mt-4 p-4">
      <SectionHeader>基本信息</SectionHeader>
      <div class="form-fields-grid mt-3">
        <label class="field-block">
          <span class="field-label">付款申请编号</span>
          <input :value="draft.no" class="field-input w-full font-mono" data-testid="finance-no" @input="patch('no', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">付款申请名称 *</span>
          <input :value="draft.name" class="field-input w-full" :class="[fieldClass('name')]" data-testid="finance-name" @input="patch('name', inputValue($event))">
          <span v-if="fieldErrors?.name" class="field-error">{{ fieldErrors.name }}</span>
        </label>
        <div class="field-block" :class="fieldClass('bizType')">
          <span class="field-label">业务类型 *</span>
          <SelectFilter :model-value="draft.bizType" :options="BIZ_TYPE_OPTIONS" full-width aria-label="业务类型" @update:model-value="patch('bizType', $event)" />
          <span v-if="fieldErrors?.bizType" class="field-error">{{ fieldErrors.bizType }}</span>
        </div>
        <div v-if="!isCompanyPayment" class="field-block" :class="fieldClass('projectId')">
          <span class="field-label">项目 *</span>
          <LookupSelect :model-value="draft.projectId" :fetch="fetchProjects" recent-key="finance-payment-project" placeholder="检索项目" @update:model-value="patch('projectId', $event)" />
          <span v-if="fieldErrors?.projectId" class="field-error">{{ fieldErrors.projectId }}</span>
        </div>
        <div class="field-block" :class="fieldClass('supplierId')">
          <span class="field-label">实际收款对象</span>
          <SelectFilter :model-value="payeeKind" :options="PAYEE_OPTIONS" full-width aria-label="实际收款对象类型" @update:model-value="choosePayeeKind" />
          <LookupSelect :key="payeeKind" :model-value="draft.workerId || draft.supplierId" :fetch="fetchPayees" :recent-key="`finance-payment-${payeeKind}`" :placeholder="payeeKind === 'worker' ? '选择全局工人' : '检索分供方'" @update:model-value="choosePayee" />
          <span v-if="fieldErrors?.supplierId" class="field-error">{{ fieldErrors.supplierId }}</span>
          <span class="field-hint">工人垫款清偿须采用原费用结算；工人工资在工资实际收付流程办理。个人临时金选择分供方。</span>
        </div>
        <div v-if="showsContract" class="field-block" :class="fieldClass('contractId')">
          <span class="field-label">关联合同 *</span>
          <LookupSelect :model-value="draft.contractId" :fetch="fetchExpenseContracts" recent-key="finance-payment-contract" :disabled-reason="draft.projectId ? undefined : '请先选择项目'" placeholder="检索支出合同" @update:model-value="patch('contractId', $event)" />
          <span v-if="fieldErrors?.contractId" class="field-error">{{ fieldErrors.contractId }}</span>
        </div>
        <div class="field-block">
          <span class="field-label">成本分类</span>
          <SelectFilter :model-value="draft.costName" :options="COST_OPTIONS" full-width aria-label="成本分类" @update:model-value="patch('costName', $event)" />
        </div>
        <label class="field-block">
          <span class="field-label">申请金额 *</span>
          <input :value="draft.applyAmount" type="number" min="0" step="0.01" class="field-input w-full font-mono" :class="[fieldClass('applyAmount')]" data-testid="finance-amount" @input="patch('applyAmount', inputNumber($event))">
          <span v-if="fieldErrors?.applyAmount" class="field-error">{{ fieldErrors.applyAmount }}</span>
        </label>
        <label class="field-block">
          <span class="field-label">申请日期 *</span>
          <input :value="draft.applyDate" type="date" class="field-input w-full" :class="[fieldClass('applyDate')]" data-testid="finance-date" @input="patch('applyDate', inputValue($event))">
          <span v-if="fieldErrors?.applyDate" class="field-error">{{ fieldErrors.applyDate }}</span>
        </label>
        <label class="field-block">
          <span class="field-label">申请人 *</span>
          <input :value="draft.applicant" class="field-input w-full" :class="[fieldClass('applicant')]" @input="patch('applicant', inputValue($event))">
          <span v-if="fieldErrors?.applicant" class="field-error">{{ fieldErrors.applicant }}</span>
        </label>
        <div class="field-block" :class="fieldClass('invoiceState')">
          <span class="field-label">回票类型 *</span>
          <SelectFilter :model-value="draft.invoiceState" :options="INVOICE_STATE_OPTIONS" full-width aria-label="回票类型" @update:model-value="patch('invoiceState', $event)" />
          <span v-if="fieldErrors?.invoiceState" class="field-error">{{ fieldErrors.invoiceState }}</span>
        </div>
        <label class="field-block form-span-full">
          <span class="field-label">付款内容</span>
          <textarea :value="draft.payContent" rows="3" class="field-input w-full" @input="patch('payContent', inputValue($event))" />
        </label>
      </div>
    </section>

    <section v-if="showsSettlements" id="section-settlements" class="panel scroll-mt-4 overflow-hidden">
      <div class="border-b border-line px-4 py-3">
        <SectionHeader>关联结算</SectionHeader>
      </div>
      <FinanceLineGrid
        kind="settlement"
        :lines="draft.settlementAllocations ?? []"
        :fetch-options="fetchSettlements"
        :disabled-reason="showsContract && !draft.contractId ? '请先选择关联合同' : undefined"
        :total-label="`已关联 ¥ ${financeDraftMoney(settlementTotal)} · 差额 ¥ ${financeDraftMoney(applyAmount - settlementTotal)}`"
        empty="选择已确认的原费用或合同结算；保留真实项目或公司归属"
        @update="updateGrid('settlementAllocations', $event)"
      />
    </section>

    <section v-if="showsInvoices" id="section-invoices" class="panel scroll-mt-4 overflow-hidden">
      <div class="border-b border-line px-4 py-3">
        <SectionHeader>关联发票</SectionHeader>
      </div>
      <FinanceLineGrid
        kind="invoice"
        :lines="draft.invoiceAllocations ?? []"
        :fetch-options="fetchInvoices"
        :total-label="`已关联 ¥ ${financeDraftMoney(invoiceTotal)} · ${draft.invoiceState === '先款后票' ? '待回票' : '差额'} ¥ ${financeDraftMoney(Math.max(applyAmount - invoiceTotal, 0))}`"
        empty="先款后票允许无票提交；后续可补关联"
        @update="updateGrid('invoiceAllocations', $event)"
      />
    </section>

    <section id="section-approval" class="panel scroll-mt-4 p-4">
      <SectionHeader>审批与支付</SectionHeader>
      <div class="form-fields-grid mt-3">
        <label v-if="draft.bizType === '预付款'" class="field-block">
          <span class="field-label">本次扣除预付款金额</span>
          <input :value="draft.prepayDeduct" type="number" min="0" step="0.01" class="field-input w-full font-mono" @input="patch('prepayDeduct', inputNumber($event))">
        </label>
        <label v-if="draft.bizType === '预付款'" class="field-block">
          <span class="field-label">扣除说明</span>
          <input :value="draft.prepayNote" class="field-input w-full" @input="patch('prepayNote', inputValue($event))">
        </label>
        <div class="field-block">
          <label for="approval-amount" class="field-label">本期批复金额</label>
          <input id="approval-amount" :value="draft.approvedAmount" type="number" min="0" step="0.01" class="field-input w-full font-mono" aria-describedby="approval-amount-help" @input="inputApproval">
          <span id="approval-amount-help" class="text-11px text-ink-faint">{{ approvalHint }}。留空表示未填写；填写 0 表示明确零元。历史金额请按原始凭据核对后填写。</span>
        </div>
        <label class="field-block form-span-full">
          <span class="field-label">审批备注</span>
          <textarea :value="draft.approvalNote" rows="2" class="field-input w-full" @input="patch('approvalNote', inputValue($event))" />
        </label>
      </div>
    </section>
  </template>

  <template v-else>
    <section id="section-basic" class="panel scroll-mt-4 p-4">
      <SectionHeader>基本信息</SectionHeader>
      <p class="mt-2 rounded-[var(--radius-control)] bg-warning-soft px-3 py-2 text-12px text-warning-deep">
        收款方以银行支付凭据为准；关联分供方仅用于连接真实对象，不会把甲方、开发商或沟通联系人自动登记为付款方。
      </p>
      <div class="form-fields-grid mt-3">
        <label class="field-block">
          <span class="field-label">支付编号</span>
          <input :value="draft.no" class="field-input w-full font-mono" data-testid="finance-no" @input="patch('no', inputValue($event))">
        </label>
        <div class="field-block">
          <span class="field-label">项目（公司付款可空）</span>
          <LookupSelect :model-value="draft.projectId" :fetch="fetchProjects" recent-key="finance-record-project" placeholder="检索项目" @update:model-value="patch('projectId', $event)" />
        </div>
        <div class="field-block" :class="fieldClass('supplierId')">
          <span class="field-label">实际收款对象 *</span>
          <SelectFilter :model-value="payeeKind" :options="PAYEE_OPTIONS" full-width aria-label="实际收款对象类型" @update:model-value="choosePayeeKind" />
          <LookupSelect :key="payeeKind" :model-value="draft.workerId || draft.supplierId" :fetch="fetchPayees" :recent-key="`finance-record-${payeeKind}`" :placeholder="payeeKind === 'worker' ? '选择全局工人' : '检索分供方'" @update:model-value="choosePayee" />
          <span v-if="fieldErrors?.supplierId" class="field-error">{{ fieldErrors.supplierId }}</span>
        </div>
        <label class="field-block">
          <span class="field-label">实际收款方名称 *</span>
          <input :value="draft.payeeName" class="field-input w-full" :class="[fieldClass('payeeName')]" data-testid="finance-name" @input="patch('payeeName', inputValue($event))">
          <span v-if="fieldErrors?.payeeName" class="field-error">{{ fieldErrors.payeeName }}</span>
        </label>
        <label class="field-block form-span-full">
          <span class="field-label">付款用途</span>
          <input :value="draft.purpose" class="field-input w-full" @input="patch('purpose', inputValue($event))">
        </label>
      </div>
    </section>

    <section id="section-amount" class="panel scroll-mt-4 p-4">
      <SectionHeader>支付与账户</SectionHeader>
      <div class="form-fields-grid mt-3">
        <label class="field-block">
          <span class="field-label">支付日期 *</span>
          <input :value="draft.paymentDate" type="date" class="field-input w-full" :class="[fieldClass('paymentDate')]" data-testid="finance-date" @input="patch('paymentDate', inputValue($event))">
          <span v-if="fieldErrors?.paymentDate" class="field-error">{{ fieldErrors.paymentDate }}</span>
        </label>
        <label class="field-block">
          <span class="field-label">支付金额 *</span>
          <input :value="draft.amount" type="number" min="0" step="0.01" class="field-input w-full font-mono" :class="[fieldClass('amount')]" data-testid="finance-amount" @input="patch('amount', inputNumber($event))">
          <span v-if="fieldErrors?.amount" class="field-error">{{ fieldErrors.amount }}</span>
        </label>
        <div class="field-block">
          <span class="field-label">支付方式</span>
          <SelectFilter :model-value="draft.paymentMethod" :options="PAYMENT_METHOD_OPTIONS" full-width aria-label="支付方式" @update:model-value="patch('paymentMethod', $event)" />
        </div>
        <label class="field-block">
          <span class="field-label">付款凭证号 *</span>
          <input :value="draft.voucherNo" class="field-input w-full font-mono" :class="[fieldClass('voucherNo')]" @input="patch('voucherNo', inputValue($event))">
          <span v-if="fieldErrors?.voucherNo" class="field-error">{{ fieldErrors.voucherNo }}</span>
        </label>
        <label class="field-block">
          <span class="field-label">银行流水号 *</span>
          <input :value="draft.bankSerialNo" class="field-input w-full font-mono" :class="[fieldClass('bankSerialNo')]" data-testid="payment-bank-serial" @input="patch('bankSerialNo', inputValue($event))">
          <span v-if="fieldErrors?.bankSerialNo" class="field-error">{{ fieldErrors.bankSerialNo }}</span>
        </label>
        <label class="field-block">
          <span class="field-label">收款账户名</span>
          <input :value="draft.payeeAccount" class="field-input w-full" @input="patch('payeeAccount', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">开户行</span>
          <input :value="draft.payeeBank" class="field-input w-full" @input="patch('payeeBank', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">银行账号</span>
          <input :value="draft.payeeBankAccount" class="field-input w-full font-mono" @input="patch('payeeBankAccount', inputValue($event))">
        </label>
      </div>
    </section>

    <section id="section-allocations" class="panel scroll-mt-4 overflow-hidden">
      <div class="border-b border-line px-4 py-3">
        <SectionHeader>付款申请分摊</SectionHeader>
      </div>
      <FinanceLineGrid
        kind="payment"
        :lines="draft.applicationAllocations ?? []"
        :fetch-options="fetchPaymentApplications"
        :total-label="`已分摊 ¥ ${financeDraftMoney(paymentAllocationTotal)} · 差额 ¥ ${financeDraftMoney(paymentAmount - paymentAllocationTotal)}`"
        empty="确认前，分摊合计必须等于支付金额"
        @update="updateGrid('applicationAllocations', $event)"
      />
    </section>

    <section id="section-review" class="panel scroll-mt-4 p-4">
      <SectionHeader>识别与人工核对</SectionHeader>
      <div class="form-fields-grid mt-3">
        <div class="field-block">
          <span class="field-label">来源</span>
          <SelectFilter :model-value="draft.source" :options="SOURCE_OPTIONS" full-width aria-label="支付来源" @update:model-value="patch('source', $event)" />
        </div>
        <div class="field-block">
          <span class="field-label">人工核对状态</span>
          <div class="field-input flex items-center bg-surface-2">
            {{ draft.confirmationStatus === 'confirmed' ? '已确认' : draft.confirmationStatus === 'needs_review' ? '待核对' : '草稿' }}
          </div>
        </div>
        <label class="field-block">
          <span class="field-label">确认人 *</span>
          <input :value="draft.confirmedBy" class="field-input w-full" :class="[fieldClass('confirmedBy')]" data-testid="payment-confirmed-by" @input="patch('confirmedBy', inputValue($event))">
          <span v-if="fieldErrors?.confirmedBy" class="field-error">{{ fieldErrors.confirmedBy }}</span>
        </label>
        <label class="field-block">
          <span class="field-label">识别状态</span>
          <input :value="draft.recognitionStatus" class="field-input w-full" @input="patch('recognitionStatus', inputValue($event))">
        </label>
        <label class="field-block form-span-full">
          <span class="field-label">OCR 原始结果（JSON）</span>
          <textarea :value="jsonValue(draft.ocrPayload)" rows="4" class="field-input w-full font-mono text-12px" data-testid="payment-ocr-payload" @input="patch('ocrPayload', inputValue($event))" />
        </label>
        <label class="field-block form-span-full">
          <span class="field-label">字段置信度（JSON）</span>
          <textarea :value="jsonValue(draft.fieldConfidence)" rows="3" class="field-input w-full font-mono text-12px" data-testid="payment-field-confidence" @input="patch('fieldConfidence', inputValue($event))" />
        </label>
        <p class="form-span-full rounded-[var(--radius-control)] bg-warning-soft px-3 py-2 text-12px text-warning-deep">
          OCR 只负责预填。无论识别置信度多高，都必须由人工点击“确认支付”；未确认记录不进入资金汇总。
        </p>
      </div>
    </section>
  </template>
</template>
