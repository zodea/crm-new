<script setup lang="ts">
import type { FinancePageDraft } from '~/lib/finance/page'
import type { LookupOption } from '~/lib/kit/lookup'
import { financeDraftMoney, financeInputNumber as inputNumber } from '~/lib/finance/input-number'

const props = defineProps<{
  kind: 'receipt' | 'invoice_application'
  draft: FinancePageDraft
  fieldErrors?: Record<string, string>
  fetchProjects: (keyword: string) => Promise<LookupOption[]>
  fetchCustomers: (keyword: string) => Promise<LookupOption[]>
  fetchIncomeContracts: (keyword: string) => Promise<LookupOption[]>
}>()

const emit = defineEmits<{
  patch: [patch: Partial<FinancePageDraft>]
  clearError: [field: string]
}>()

function options(values: string[]) {
  return values.map(value => ({ key: value, label: value }))
}

const PAYMENT_METHOD_OPTIONS = options(['银行转账', '承兑汇票', '现金', '其他'])
const RECEIPT_REVIEW_OPTIONS = options(['待审核', '已审核', '已驳回'])
const INVOICE_TYPE_OPTIONS = options(['增值税专用发票', '增值税普通发票', '电子普通发票'])

function patch(field: keyof FinancePageDraft, value: unknown) {
  const next = { [field]: value } as Partial<FinancePageDraft>
  if (field === 'projectId')
    Object.assign(next, { contractId: null })
  emit('patch', next)
  emit('clearError', String(field))
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}

function fieldClass(field: string) {
  return props.fieldErrors?.[field] ? 'border-danger! ring-1 ring-danger/20' : ''
}
</script>

<template>
  <template v-if="kind === 'receipt'">
    <section id="section-basic" class="panel scroll-mt-4 p-4">
      <SectionHeader>基本信息</SectionHeader>
      <div class="form-fields-grid mt-3">
        <label class="field-block">
          <span class="field-label">收款单号</span>
          <input :value="draft.no" class="field-input w-full font-mono" data-testid="finance-no" @input="patch('no', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">收款日期 *</span>
          <input :value="draft.receiptDate" type="date" class="field-input w-full" :class="[fieldClass('receiptDate')]" data-testid="finance-date" @input="patch('receiptDate', inputValue($event))">
          <span v-if="fieldErrors?.receiptDate" class="field-error">{{ fieldErrors.receiptDate }}</span>
        </label>
        <div class="field-block" :class="fieldClass('projectId')">
          <span class="field-label">项目 *</span>
          <LookupSelect :model-value="draft.projectId" :fetch="fetchProjects" recent-key="finance-receipt-project" placeholder="检索项目" @update:model-value="patch('projectId', $event)" />
          <span v-if="fieldErrors?.projectId" class="field-error">{{ fieldErrors.projectId }}</span>
        </div>
        <div class="field-block">
          <span class="field-label">施工合同</span>
          <LookupSelect :model-value="draft.contractId" :fetch="fetchIncomeContracts" recent-key="finance-receipt-contract" :disabled-reason="draft.projectId ? undefined : '请先选择项目'" placeholder="检索施工合同" @update:model-value="patch('contractId', $event)" />
        </div>
        <div class="field-block" :class="fieldClass('customerId')">
          <span class="field-label">付款方客户 *</span>
          <LookupSelect :model-value="draft.customerId" :fetch="fetchCustomers" recent-key="finance-receipt-customer" placeholder="检索客户" @update:model-value="patch('customerId', $event)" />
          <span v-if="fieldErrors?.customerId" class="field-error">{{ fieldErrors.customerId }}</span>
        </div>
        <div class="field-block">
          <span class="field-label">收款方（我方乙方）</span>
          <div class="field-input flex items-center bg-surface-2 text-ink-soft" data-testid="receipt-payee">
            我方乙方
          </div>
          <p class="field-hint">
            收款登记固定表示甲方客户向我方收款账户支付的真实收入。
          </p>
        </div>
        <label class="field-block">
          <span class="field-label">付款方账号</span>
          <input :value="draft.payerAccount" class="field-input w-full" @input="patch('payerAccount', inputValue($event))">
        </label>
      </div>
    </section>

    <section id="section-amount" class="panel scroll-mt-4 p-4">
      <SectionHeader>金额与方式</SectionHeader>
      <div class="form-fields-grid mt-3">
        <label class="field-block">
          <span class="field-label">收款金额 *</span>
          <input :value="draft.amount" type="number" min="0" step="0.01" class="field-input w-full font-mono" :class="[fieldClass('amount')]" data-testid="finance-amount" @input="patch('amount', inputNumber($event))">
          <span v-if="fieldErrors?.amount" class="field-error">{{ fieldErrors.amount }}</span>
        </label>
        <div class="field-block">
          <span class="field-label">收款方式</span>
          <SelectFilter :model-value="draft.paymentMethod" :options="PAYMENT_METHOD_OPTIONS" full-width aria-label="收款方式" @update:model-value="patch('paymentMethod', $event)" />
        </div>
        <label class="field-block">
          <span class="field-label">承兑汇票号</span>
          <input :value="draft.acceptanceBillNo" class="field-input w-full" @input="patch('acceptanceBillNo', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">汇票到期日</span>
          <input :value="draft.billDueDate" type="date" class="field-input w-full" @input="patch('billDueDate', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">收款期次</span>
          <input :value="draft.periodNo" class="field-input w-full" @input="patch('periodNo', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">银行流水号</span>
          <input :value="draft.bankSerialNo" class="field-input w-full font-mono" @input="patch('bankSerialNo', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">经办人</span>
          <input :value="draft.handler" class="field-input w-full" @input="patch('handler', inputValue($event))">
        </label>
        <div class="field-block">
          <span class="field-label">审核状态</span>
          <SelectFilter :model-value="draft.reviewStatus" :options="RECEIPT_REVIEW_OPTIONS" full-width aria-label="审核状态" @update:model-value="patch('reviewStatus', $event)" />
        </div>
      </div>
    </section>
  </template>

  <template v-else>
    <section id="section-basic" class="panel scroll-mt-4 p-4">
      <SectionHeader>基本信息</SectionHeader>
      <div class="form-fields-grid mt-3">
        <label class="field-block">
          <span class="field-label">申请编号</span>
          <input :value="draft.no" class="field-input w-full font-mono" data-testid="finance-no" @input="patch('no', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">开票申请名称 *</span>
          <input :value="draft.name" class="field-input w-full" :class="[fieldClass('name')]" data-testid="finance-name" @input="patch('name', inputValue($event))">
          <span v-if="fieldErrors?.name" class="field-error">{{ fieldErrors.name }}</span>
        </label>
        <div class="field-block" :class="fieldClass('projectId')">
          <span class="field-label">项目 *</span>
          <LookupSelect :model-value="draft.projectId" :fetch="fetchProjects" recent-key="finance-billing-project" placeholder="检索项目" @update:model-value="patch('projectId', $event)" />
          <span v-if="fieldErrors?.projectId" class="field-error">{{ fieldErrors.projectId }}</span>
        </div>
        <div class="field-block">
          <span class="field-label">施工合同</span>
          <LookupSelect :model-value="draft.contractId" :fetch="fetchIncomeContracts" recent-key="finance-billing-contract" :disabled-reason="draft.projectId ? undefined : '请先选择项目'" placeholder="检索施工合同" @update:model-value="patch('contractId', $event)" />
        </div>
        <div class="field-block" :class="fieldClass('customerId')">
          <span class="field-label">购方客户 *</span>
          <LookupSelect :model-value="draft.customerId" :fetch="fetchCustomers" recent-key="finance-billing-customer" placeholder="检索客户" @update:model-value="patch('customerId', $event)" />
          <span v-if="fieldErrors?.customerId" class="field-error">{{ fieldErrors.customerId }}</span>
        </div>
        <div class="field-block">
          <span class="field-label">发票类型</span>
          <SelectFilter :model-value="draft.invoiceType" :options="INVOICE_TYPE_OPTIONS" full-width aria-label="发票类型" @update:model-value="patch('invoiceType', $event)" />
        </div>
        <label class="field-block">
          <span class="field-label">购方名称快照 *</span>
          <input :value="draft.buyerNameSnapshot" class="field-input w-full" :class="[fieldClass('buyerNameSnapshot')]" @input="patch('buyerNameSnapshot', inputValue($event))">
          <span v-if="fieldErrors?.buyerNameSnapshot" class="field-error">{{ fieldErrors.buyerNameSnapshot }}</span>
        </label>
        <label class="field-block">
          <span class="field-label">购方税号快照 *</span>
          <input :value="draft.buyerTaxNoSnapshot" class="field-input w-full font-mono" :class="[fieldClass('buyerTaxNoSnapshot')]" @input="patch('buyerTaxNoSnapshot', inputValue($event))">
          <span v-if="fieldErrors?.buyerTaxNoSnapshot" class="field-error">{{ fieldErrors.buyerTaxNoSnapshot }}</span>
        </label>
      </div>
    </section>
    <section id="section-amount" class="panel scroll-mt-4 p-4">
      <SectionHeader>金额与税率</SectionHeader>
      <div class="form-fields-grid mt-3">
        <label class="field-block">
          <span class="field-label">开票金额 *</span>
          <input :value="draft.amount" type="number" min="0" step="0.01" class="field-input w-full font-mono" :class="[fieldClass('amount')]" data-testid="finance-amount" @input="patch('amount', inputNumber($event))">
          <span v-if="fieldErrors?.amount" class="field-error">{{ fieldErrors.amount }}</span>
        </label>
        <label class="field-block">
          <span class="field-label">税率（%）</span>
          <input :value="draft.taxRate" type="number" min="0" step="0.01" class="field-input w-full font-mono" @input="patch('taxRate', inputNumber($event))">
        </label>
        <label class="field-block">
          <span class="field-label">税额</span>
          <input :value="draft.taxAmount" type="number" min="0" step="0.01" class="field-input w-full font-mono" @input="patch('taxAmount', inputNumber($event))">
        </label>
        <div class="field-block">
          <span class="field-label">价税合计（只读）</span>
          <div class="field-input flex items-center bg-surface-2 font-mono">
            ¥ {{ financeDraftMoney(draft.amount == null || draft.taxAmount == null ? null : Number(draft.amount) + Number(draft.taxAmount)) }}
          </div>
        </div>
        <label class="field-block form-span-full">
          <span class="field-label">开票内容</span>
          <textarea :value="draft.invoiceContent" rows="3" class="field-input w-full" @input="patch('invoiceContent', inputValue($event))" />
        </label>
        <label class="field-block form-span-full">
          <span class="field-label">票面备注</span>
          <textarea :value="draft.invoiceRemark" rows="2" class="field-input w-full" @input="patch('invoiceRemark', inputValue($event))" />
        </label>
        <label class="field-block">
          <span class="field-label">申请人</span>
          <input :value="draft.applicant" class="field-input w-full" @input="patch('applicant', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">申请日期 *</span>
          <input :value="draft.applicationDate" type="date" class="field-input w-full" :class="[fieldClass('applicationDate')]" data-testid="finance-date" @input="patch('applicationDate', inputValue($event))">
          <span v-if="fieldErrors?.applicationDate" class="field-error">{{ fieldErrors.applicationDate }}</span>
        </label>
      </div>
    </section>
  </template>
</template>
