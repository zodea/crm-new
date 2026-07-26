<script setup lang="ts">
import type {
  CompanyExpenseContractFormDraft,
  ExpenditureSettlementFormDraft,
  F2FormKind,
  ProjectContractFormDraft,
} from '~/lib/contract/forms'
import type { LookupOption } from '~/lib/kit/lookup'
import { computed } from 'vue'

type PageDraft
  = ProjectContractFormDraft
    & CompanyExpenseContractFormDraft
    & ExpenditureSettlementFormDraft

const props = defineProps<{
  kind: F2FormKind
  editing?: boolean
  draft: PageDraft
  fieldErrors: Record<string, string>
  fetchProjects: (keyword: string) => Promise<LookupOption[]>
  fetchCustomers: (keyword: string) => Promise<LookupOption[]>
  fetchSuppliers: (keyword: string) => Promise<LookupOption[]>
  fetchOriginalContracts: (keyword: string) => Promise<LookupOption[]>
  fetchOtherExpenseContracts: (keyword: string) => Promise<LookupOption[]>
  aggregate?: {
    changed: number
    settled: number
    invoiced: number
    paid: number
  } | null
  selectedContractAmount?: number | null
}>()

const emit = defineEmits<{
  patch: [patch: Partial<PageDraft>]
  clearError: [field: string]
}>()

const isProjectContract = computed(() =>
  ['construction', 'subcontract', 'material', 'other_expense'].includes(props.kind),
)
const isExpenseContract = computed(() =>
  ['subcontract', 'material', 'other_expense'].includes(props.kind),
)
const isSupplement = computed(() =>
  isProjectContract.value && Boolean(props.draft.isSupplement),
)
const taxExclusiveAmount = computed(() => {
  const amount = Number(props.draft.amount) || 0
  const rate = Number(props.draft.taxRate) || 0
  return rate >= 0 ? amount / (1 + rate / 100) : 0
})
const taxAmount = computed(() =>
  (Number(props.draft.amount) || 0) - taxExclusiveAmount.value,
)

function options(values: Array<string | number>) {
  return values.map(value => ({ key: String(value), label: String(value) }))
}

const SUB_KIND_OPTIONS = options(['劳务', '专业'])
const OTHER_EXPENSE_KIND_OPTIONS = options(['机械租赁', '检测服务', '其他'])
const CONTRACT_STATUS_OPTIONS = options(['草稿', '审批中', '已签订', '履约中', '已结算', '已结清'])
const SUPPLEMENT_STATUS_OPTIONS = options(['草稿', '审批中', '有效'])
const INVOICE_TYPE_OPTIONS = options(['增值税专用发票', '增值税普通发票'])
const TAX_RATE_OPTIONS = [13, 9, 6, 3, 1, 0].map(rate => ({
  key: String(rate),
  label: `${rate}%`,
}))
const PAYMENT_CYCLE_OPTIONS = options(['月付', '季付', '年付', '一次性'])
const COMPANY_CATEGORY_OPTIONS = options(['房租', '软件', '其他'])
const FORM_STATUS_OPTIONS = options(['草稿', '审批中'])

function patch(field: keyof PageDraft, value: unknown) {
  emit('patch', { [field]: value } as Partial<PageDraft>)
  emit('clearError', String(field))
}

function fieldClass(field: keyof PageDraft) {
  return props.fieldErrors[String(field)]
    ? 'field-input w-full border-danger! ring-1 ring-danger/20'
    : 'field-input w-full'
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}

function inputNumber(event: Event): number {
  return Number((event.target as HTMLInputElement).value) || 0
}

function inputChecked(event: Event): boolean {
  return (event.target as HTMLInputElement).checked
}
</script>

<template>
  <template v-if="isProjectContract">
    <section id="section-basic" class="panel scroll-mt-4 p-4">
      <SectionHeader title="基本信息" />
      <div class="form-fields-grid">
        <label class="field-block">
          <span class="field-label">合同编号</span>
          <input
            :value="draft.no"
            class="field-input w-full font-mono"
            data-testid="contract-no"
            @input="patch('no', inputValue($event))"
          >
        </label>
        <label class="field-block">
          <span class="field-label">{{ isSupplement ? '协议名称' : '合同名称' }} *</span>
          <input
            :value="draft.name"
            :class="fieldClass('name')"
            data-testid="contract-name"
            @input="patch('name', inputValue($event))"
          >
          <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
        </label>

        <label class="field-block form-span-full">
          <span class="inline-flex items-center gap-2 text-12px text-ink-soft">
            <input
              :checked="draft.isSupplement"
              :disabled="editing"
              type="checkbox"
              class="accent-brand"
              data-testid="contract-is-supplement"
              @change="patch('isSupplement', inputChecked($event))"
            >
            这是补充协议
          </span>
        </label>

        <label v-if="isSupplement" class="field-block form-span-full">
          <span class="field-label">原合同 *</span>
          <LookupSelect
            :model-value="draft.originalContractId"
            :fetch="fetchOriginalContracts"
            :recent-key="`supplement-original-${kind}`"
            placeholder="检索原合同"
            @update:model-value="patch('originalContractId', $event)"
          />
          <span v-if="fieldErrors.originalContractId" class="field-error">{{ fieldErrors.originalContractId }}</span>
        </label>

        <template v-else>
          <label class="field-block">
            <span class="field-label">项目 *</span>
            <LookupSelect
              :model-value="draft.projectId"
              :fetch="fetchProjects"
              :recent-key="`contract-project-${kind}`"
              placeholder="检索项目"
              @update:model-value="patch('projectId', $event)"
            />
            <span v-if="fieldErrors.projectId" class="field-error">{{ fieldErrors.projectId }}</span>
          </label>
          <label v-if="kind === 'construction'" class="field-block">
            <span class="field-label">甲方（客户） *</span>
            <LookupSelect
              :model-value="draft.customerId"
              :fetch="fetchCustomers"
              recent-key="construction-contract-customer"
              placeholder="检索客户"
              @update:model-value="patch('customerId', $event)"
            />
            <span v-if="fieldErrors.customerId" class="field-error">{{ fieldErrors.customerId }}</span>
          </label>
          <label v-if="isExpenseContract" class="field-block">
            <span class="field-label">乙方（分供方） *</span>
            <LookupSelect
              :model-value="draft.supplierId"
              :fetch="fetchSuppliers"
              :recent-key="`contract-supplier-${kind}`"
              placeholder="检索分供方"
              @update:model-value="patch('supplierId', $event)"
            />
            <span v-if="fieldErrors.supplierId" class="field-error">{{ fieldErrors.supplierId }}</span>
          </label>
          <div v-if="kind === 'subcontract'" class="field-block">
            <span class="field-label">分包类别</span>
            <SelectFilter
              :model-value="draft.subKind"
              :options="SUB_KIND_OPTIONS"
              aria-label="分包类别"
              full-width
              @update:model-value="patch('subKind', $event)"
            />
          </div>
          <div v-if="kind === 'other_expense'" class="field-block">
            <span class="field-label">类别</span>
            <SelectFilter
              :model-value="draft.otherExpenseKind"
              :options="OTHER_EXPENSE_KIND_OPTIONS"
              aria-label="其他支出类别"
              full-width
              @update:model-value="patch('otherExpenseKind', $event)"
            />
          </div>
        </template>

        <label class="field-block form-span-full">
          <span class="field-label">{{ isSupplement ? '协议内容' : '合同内容简述' }} *</span>
          <textarea
            :value="draft.content"
            rows="3"
            :class="fieldClass('content')"
            data-testid="contract-content"
            @input="patch('content', inputValue($event))"
          />
          <span v-if="fieldErrors.content" class="field-error">{{ fieldErrors.content }}</span>
        </label>
        <label class="field-block">
          <span class="field-label">签约日期 *</span>
          <input
            :value="draft.signDate"
            type="date"
            :class="fieldClass('signDate')"
            data-testid="contract-sign-date"
            @input="patch('signDate', inputValue($event))"
          >
          <span v-if="fieldErrors.signDate" class="field-error">{{ fieldErrors.signDate }}</span>
        </label>
        <div class="field-block">
          <span class="field-label">{{ isSupplement ? '协议状态' : '合同状态' }}</span>
          <SelectFilter
            :model-value="draft.status"
            :options="isSupplement ? SUPPLEMENT_STATUS_OPTIONS : CONTRACT_STATUS_OPTIONS"
            :aria-label="isSupplement ? '协议状态' : '合同状态'"
            full-width
            @update:model-value="patch('status', $event)"
          />
        </div>
        <div v-if="!isSupplement" class="field-block">
          <span class="field-label">发票类型</span>
          <SelectFilter
            :model-value="draft.invoiceType"
            :options="INVOICE_TYPE_OPTIONS"
            aria-label="发票类型"
            full-width
            @update:model-value="patch('invoiceType', $event)"
          />
        </div>
        <label v-if="!isSupplement" class="field-block">
          <span class="field-label">履约联系人</span>
          <input :value="draft.contactName" class="field-input w-full" @input="patch('contactName', inputValue($event))">
        </label>
        <label v-if="!isSupplement" class="field-block">
          <span class="field-label">联系方式</span>
          <input :value="draft.contactPhone" class="field-input w-full" @input="patch('contactPhone', inputValue($event))">
        </label>
      </div>
    </section>

    <section id="section-amount" class="panel scroll-mt-4 p-4">
      <SectionHeader :title="isSupplement ? '协议金额' : '合同金额'" />
      <div class="form-fields-grid">
        <label class="field-block">
          <span class="field-label">{{ isSupplement ? '补充协议金额' : '含税合同金额' }} *</span>
          <input
            :value="draft.amount ?? 0"
            type="number"
            min="0"
            step="0.01"
            :class="fieldClass('amount')"
            data-testid="contract-amount"
            @input="patch('amount', inputNumber($event))"
          >
          <span v-if="fieldErrors.amount" class="field-error">{{ fieldErrors.amount }}</span>
        </label>
        <template v-if="!isSupplement">
          <div class="field-block">
            <span class="field-label">税率</span>
            <SelectFilter
              :model-value="String(draft.taxRate ?? 0)"
              :options="TAX_RATE_OPTIONS"
              aria-label="税率"
              full-width
              @update:model-value="patch('taxRate', Number($event))"
            />
          </div>
          <div class="field-block">
            <span class="field-label">无税金额</span>
            <div class="field-readonly">
              {{ taxExclusiveAmount.toFixed(2) }}
            </div>
          </div>
          <div class="field-block">
            <span class="field-label">税额</span>
            <div class="field-readonly">
              {{ taxAmount.toFixed(2) }}
            </div>
          </div>
          <div v-if="aggregate" class="field-block">
            <span class="field-label">变更后合同金额</span>
            <div class="field-readonly">
              {{ aggregate.changed.toFixed(2) }}
            </div>
          </div>
          <div v-if="aggregate" class="field-block">
            <span class="field-label">累计结算</span>
            <div class="field-readonly">
              {{ aggregate.settled.toFixed(2) }}
            </div>
          </div>
          <div v-if="aggregate" class="field-block">
            <span class="field-label">{{ kind === 'construction' ? '累计开票' : '累计收票' }}</span>
            <div class="field-readonly">
              {{ aggregate.invoiced.toFixed(2) }}
            </div>
          </div>
          <div v-if="aggregate" class="field-block">
            <span class="field-label">{{ kind === 'construction' ? '累计收款' : '累计支付' }}</span>
            <div class="field-readonly">
              {{ aggregate.paid.toFixed(2) }}
            </div>
          </div>
          <div v-if="kind === 'other_expense'" class="field-block">
            <span class="field-label">付款周期</span>
            <SelectFilter
              :model-value="draft.paymentCycle"
              :options="PAYMENT_CYCLE_OPTIONS"
              aria-label="付款周期"
              full-width
              @update:model-value="patch('paymentCycle', $event)"
            />
          </div>
          <label v-if="kind === 'other_expense'" class="field-block">
            <span class="field-label">租期或服务期</span>
            <input :value="draft.servicePeriod" class="field-input w-full" @input="patch('servicePeriod', inputValue($event))">
          </label>
        </template>
      </div>
    </section>

    <section v-if="!isSupplement" id="section-terms" class="panel scroll-mt-4 p-4">
      <SectionHeader title="合同条款" />
      <div class="form-fields-grid">
        <label class="field-block form-span-full">
          <span class="field-label">主要条款</span>
          <textarea :value="draft.mainTerms" rows="3" class="field-input w-full" @input="patch('mainTerms', inputValue($event))" />
        </label>
        <template v-if="kind !== 'other_expense'">
          <label class="field-block">
            <span class="field-label">支付及结算方式</span>
            <textarea :value="draft.paymentTerms" rows="3" class="field-input w-full" @input="patch('paymentTerms', inputValue($event))" />
          </label>
          <label class="field-block">
            <span class="field-label">品牌及质量标准</span>
            <textarea :value="draft.brandQualityTerms" rows="3" class="field-input w-full" @input="patch('brandQualityTerms', inputValue($event))" />
          </label>
          <label class="field-block">
            <span class="field-label">工期或交付时间</span>
            <textarea :value="draft.scheduleTerms" rows="3" class="field-input w-full" @input="patch('scheduleTerms', inputValue($event))" />
          </label>
          <label class="field-block">
            <span class="field-label">质量保修责任</span>
            <textarea :value="draft.warrantyTerms" rows="3" class="field-input w-full" @input="patch('warrantyTerms', inputValue($event))" />
          </label>
          <label class="field-block form-span-full">
            <span class="field-label">特别约定</span>
            <textarea :value="draft.specialTerms" rows="3" class="field-input w-full" @input="patch('specialTerms', inputValue($event))" />
          </label>
        </template>
      </div>
    </section>

    <section v-if="kind !== 'other_expense' && !isSupplement" id="section-retention" class="panel scroll-mt-4 p-4">
      <SectionHeader title="质保金信息" />
      <div class="form-fields-grid">
        <label class="field-block">
          <span class="field-label">质保金比例（%）</span>
          <input
            :value="(draft.retentionRatio ?? 0) * 100"
            type="number"
            min="0"
            max="100"
            step="0.01"
            class="field-input w-full"
            @input="patch('retentionRatio', inputNumber($event) / 100)"
          >
        </label>
        <label class="field-block">
          <span class="field-label">质保金金额</span>
          <input :value="draft.retentionAmount ?? 0" type="number" min="0" step="0.01" class="field-input w-full" @input="patch('retentionAmount', inputNumber($event))">
        </label>
        <label class="field-block">
          <span class="field-label">质保期（天）</span>
          <input :value="draft.retentionDays ?? 0" type="number" min="0" class="field-input w-full" @input="patch('retentionDays', inputNumber($event))">
        </label>
      </div>
    </section>

    <section v-if="kind !== 'other_expense' && !isSupplement" id="section-invoice" class="panel scroll-mt-4 p-4">
      <SectionHeader title="开票方信息" />
      <div class="form-fields-grid">
        <label class="field-block">
          <span class="field-label">开票名称</span>
          <input :value="draft.invoiceName" class="field-input w-full" @input="patch('invoiceName', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">纳税人识别号</span>
          <input :value="draft.invoiceTaxNo" class="field-input w-full font-mono" @input="patch('invoiceTaxNo', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">开票地址及电话</span>
          <input :value="draft.invoiceAddressPhone" class="field-input w-full" @input="patch('invoiceAddressPhone', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">开户行</span>
          <input :value="draft.invoiceBank" class="field-input w-full" @input="patch('invoiceBank', inputValue($event))">
        </label>
        <label class="field-block form-span-full">
          <span class="field-label">银行账号</span>
          <input :value="draft.invoiceBankAccount" class="field-input w-full font-mono" @input="patch('invoiceBankAccount', inputValue($event))">
        </label>
      </div>
    </section>
  </template>

  <template v-else-if="kind === 'company_expense'">
    <section id="section-basic" class="panel scroll-mt-4 p-4">
      <SectionHeader title="基本信息" />
      <div class="form-fields-grid">
        <label class="field-block">
          <span class="field-label">合同编号</span>
          <input :value="draft.no" class="field-input w-full font-mono" @input="patch('no', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">合同名称 *</span>
          <input :value="draft.name" :class="fieldClass('name')" data-testid="company-contract-name" @input="patch('name', inputValue($event))">
          <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
        </label>
        <div class="field-block">
          <span class="field-label">类别</span>
          <SelectFilter
            :model-value="draft.category"
            :options="COMPANY_CATEGORY_OPTIONS"
            aria-label="公司支出类别"
            full-width
            @update:model-value="patch('category', $event)"
          />
        </div>
        <label class="field-block">
          <span class="field-label">对方单位 *</span>
          <input :value="draft.counterparty" :class="fieldClass('counterparty')" @input="patch('counterparty', inputValue($event))">
          <span v-if="fieldErrors.counterparty" class="field-error">{{ fieldErrors.counterparty }}</span>
        </label>
        <label class="field-block">
          <span class="field-label">签订日期 *</span>
          <input :value="draft.signDate" type="date" :class="fieldClass('signDate')" @input="patch('signDate', inputValue($event))">
          <span v-if="fieldErrors.signDate" class="field-error">{{ fieldErrors.signDate }}</span>
        </label>
        <label class="field-block">
          <span class="field-label">租期或服务期</span>
          <input :value="draft.servicePeriod" class="field-input w-full" @input="patch('servicePeriod', inputValue($event))">
        </label>
        <div class="field-block">
          <span class="field-label">状态</span>
          <SelectFilter
            :model-value="draft.status"
            :options="FORM_STATUS_OPTIONS"
            aria-label="公司支出状态"
            full-width
            @update:model-value="patch('status', $event)"
          />
        </div>
      </div>
    </section>
    <section id="section-amount" class="panel scroll-mt-4 p-4">
      <SectionHeader title="合同金额" />
      <div class="form-fields-grid">
        <label class="field-block">
          <span class="field-label">合同金额 *</span>
          <input :value="draft.amount ?? 0" type="number" min="0" step="0.01" :class="fieldClass('amount')" @input="patch('amount', inputNumber($event))">
        </label>
        <div class="field-block">
          <span class="field-label">付款周期</span>
          <SelectFilter
            :model-value="draft.paymentCycle"
            :options="PAYMENT_CYCLE_OPTIONS"
            aria-label="付款周期"
            full-width
            @update:model-value="patch('paymentCycle', $event)"
          />
        </div>
      </div>
    </section>
    <section id="section-terms" class="panel scroll-mt-4 p-4">
      <SectionHeader title="条款与附件" />
      <label class="field-block mt-3">
        <span class="field-label">主要条款</span>
        <textarea :value="draft.mainTerms" rows="4" class="field-input w-full" @input="patch('mainTerms', inputValue($event))" />
      </label>
    </section>
  </template>

  <template v-else>
    <section id="section-basic" class="panel scroll-mt-4 p-4">
      <SectionHeader title="基本信息" />
      <div class="form-fields-grid">
        <label class="field-block">
          <span class="field-label">结算单号</span>
          <input :value="draft.no" class="field-input w-full font-mono" @input="patch('no', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">结算名称 *</span>
          <input :value="draft.name" :class="fieldClass('name')" data-testid="settlement-name" @input="patch('name', inputValue($event))">
          <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
        </label>
        <label class="field-block">
          <span class="field-label">项目 *</span>
          <LookupSelect
            :model-value="draft.projectId"
            :fetch="fetchProjects"
            recent-key="other-settlement-project"
            placeholder="检索项目"
            @update:model-value="patch('projectId', $event)"
          />
          <span v-if="fieldErrors.projectId" class="field-error">{{ fieldErrors.projectId }}</span>
        </label>
        <label class="field-block">
          <span class="field-label">其他支出合同 *</span>
          <LookupSelect
            :model-value="draft.contractId"
            :fetch="fetchOtherExpenseContracts"
            recent-key="other-settlement-contract"
            :disabled-reason="draft.projectId ? undefined : '请先选择项目'"
            placeholder="检索其他支出合同"
            @update:model-value="patch('contractId', $event)"
          />
          <span v-if="fieldErrors.contractId" class="field-error">{{ fieldErrors.contractId }}</span>
        </label>
      </div>
    </section>
    <section id="section-amount" class="panel scroll-mt-4 p-4">
      <SectionHeader title="结算金额" />
      <div class="form-fields-grid">
        <label class="field-block">
          <span class="field-label">结算金额 *</span>
          <input :value="draft.totalAmount ?? 0" type="number" min="0" step="0.01" :class="fieldClass('totalAmount')" data-testid="settlement-amount" @input="patch('totalAmount', inputNumber($event))">
        </label>
        <label class="field-block">
          <span class="field-label">结算日期 *</span>
          <input :value="draft.settlementDate" type="date" :class="fieldClass('settlementDate')" @input="patch('settlementDate', inputValue($event))">
          <span v-if="fieldErrors.settlementDate" class="field-error">{{ fieldErrors.settlementDate }}</span>
        </label>
        <label class="field-block">
          <span class="field-label">结算期间</span>
          <input :value="draft.settlementPeriod" class="field-input w-full" @input="patch('settlementPeriod', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">扣减说明</span>
          <input :value="draft.deductionNote" class="field-input w-full" @input="patch('deductionNote', inputValue($event))">
        </label>
        <div class="field-block">
          <span class="field-label">状态</span>
          <SelectFilter
            :model-value="draft.status"
            :options="FORM_STATUS_OPTIONS"
            aria-label="结算状态"
            full-width
            @update:model-value="patch('status', $event)"
          />
        </div>
      </div>
    </section>
    <section id="section-contract" class="panel scroll-mt-4 p-4">
      <SectionHeader title="合同情况（带出）" />
      <div class="mt-3 grid gap-2 sm:grid-cols-2">
        <div class="info-cell rounded-[var(--radius-control)] border border-line">
          <span class="block text-11px text-ink-faint">合同金额</span>
          <strong class="mt-1 block font-mono text-16px text-ink">
            {{ selectedContractAmount == null ? '—' : selectedContractAmount.toFixed(2) }}
          </strong>
        </div>
        <div class="info-cell rounded-[var(--radius-control)] border border-line">
          <span class="block text-11px text-ink-faint">关联规则</span>
          <strong class="mt-1 block text-13px text-ink">项目、分供方由合同真实关系带出</strong>
        </div>
      </div>
    </section>
  </template>
</template>

<style scoped>
.form-fields-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  gap: 0.75rem 1rem;
  margin-top: 0.75rem;
}

.field-block {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.3rem;
}

.form-span-full {
  grid-column: 1 / -1;
}

.field-error {
  color: var(--danger);
  font-size: 11px;
  line-height: 1.3;
}

.field-readonly {
  min-height: 34px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  background: var(--surface-2);
  padding: 7px 10px;
  color: var(--ink-soft);
  font-family: var(--font-mono);
  font-size: 13px;
}
</style>
