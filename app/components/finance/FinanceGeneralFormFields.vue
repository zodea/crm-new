<script setup lang="ts">
import type { ConstructionMainSelection } from '~/lib/construction-scope/contract'
import type { FinancePageDraft } from '~/lib/finance/page'
import type { LookupOption } from '~/lib/kit/lookup'
import { computed, onBeforeUnmount, onDeactivated, shallowRef, watch } from 'vue'
import { useToast } from '~/composables/useToast'
import { financeDraftMoney, financeInputNumber as inputNumber } from '~/lib/finance/input-number'
import FinanceLineGrid from './FinanceLineGrid.vue'

const props = defineProps<{
  kind: 'current' | 'reimbursement'
  draft: FinancePageDraft
  fieldErrors?: Record<string, string>
  fetchProjects: (keyword: string) => Promise<LookupOption[]>
  fetchConstructionMains?: (keyword: string) => Promise<Array<LookupOption & { constructionMain: ConstructionMainSelection }>>
  fetchWorkers?: (keyword: string) => Promise<LookupOption[]>
  fetchOriginalExpenses?: (keyword: string) => Promise<LookupOption[]>
  fetchSuppliers: (keyword: string) => Promise<LookupOption[]>
}>()

const emit = defineEmits<{
  patch: [patch: Partial<FinancePageDraft>]
  clearError: [field: string]
}>()
const toast = useToast()
let engineeringSelection = 0
watch(() => [props.kind, props.draft.id, props.fetchConstructionMains], () => engineeringSelection++, { flush: 'sync' })
onDeactivated(() => engineeringSelection++)
onBeforeUnmount(() => engineeringSelection++)

const selectedApplicantKind = shallowRef<'worker' | 'supplier' | null>(null)
watch(() => `${props.kind}:${props.draft.id ?? 'new'}`, () => {
  selectedApplicantKind.value = null
})
const applicantKind = computed(() => selectedApplicantKind.value ?? (props.draft.applicantSupplierId ? 'supplier' : 'worker'))
const APPLICANT_KIND_OPTIONS = [{ key: 'worker', label: '工人清单' }, { key: 'supplier', label: '分供方清单' }]
function changeApplicantKind(value: string | null | undefined) {
  selectedApplicantKind.value = value === 'supplier' ? 'supplier' : 'worker'
  emit('patch', { applicantWorkerId: null, applicantSupplierId: null, applicantNameSnapshot: null })
}
const PAYMENT_METHOD_OPTIONS = ['银行转账', '承兑汇票', '现金', '其他']
  .map(value => ({ key: value, label: value }))
const DIRECTION_OPTIONS = [
  { key: 'receipt', label: '收款' },
  { key: 'payment', label: '付款' },
]
const reimbursementTotal = computed(() =>
  (props.draft.lines ?? []).reduce((sum, line) => sum + (line.amount == null ? Number.NaN : Number(line.amount)), 0),
)

function patch(field: keyof FinancePageDraft, value: unknown) {
  emit('patch', { [field]: value } as Partial<FinancePageDraft>)
  emit('clearError', String(field))
}

function updateLines(lines: unknown[]) {
  emit('patch', { lines } as Partial<FinancePageDraft>)
  emit('clearError', 'lines')
}
async function selectEngineering(id: string | null) {
  const selection = ++engineeringSelection
  const fetch = props.fetchConstructionMains
  if (!id || !fetch) {
    emit('patch', { constructionMain: undefined, projectId: null })
    return
  }
  try {
    const selected = (await fetch(id)).find(row => row.id === id)?.constructionMain
    if (selection === engineeringSelection && selected)
      emit('patch', { constructionMain: selected, projectId: selected.projectId })
  }
  catch (error) {
    if (selection === engineeringSelection)
      toast.error('工程选择未完成', error instanceof Error ? error.message : '请重试读取工程资格。')
  }
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}

function fieldClass(field: string) {
  return props.fieldErrors?.[field] ? 'border-danger! ring-1 ring-danger/20' : ''
}
</script>

<template>
  <template v-if="kind === 'current'">
    <section id="section-basic" class="panel scroll-mt-4 p-4">
      <SectionHeader>基本信息</SectionHeader>
      <div class="form-fields-grid mt-3">
        <label class="field-block">
          <span class="field-label">单据编号</span>
          <input :value="draft.no" class="field-input w-full font-mono" data-testid="finance-no" @input="patch('no', inputValue($event))">
        </label>
        <div class="field-block" :class="fieldClass('direction')">
          <span class="field-label">收付方向 *</span>
          <SelectFilter :model-value="draft.direction" :options="DIRECTION_OPTIONS" full-width aria-label="收付方向" @update:model-value="patch('direction', $event)" />
          <span v-if="fieldErrors?.direction" class="field-error">{{ fieldErrors.direction }}</span>
        </div>
        <div class="field-block" :class="fieldClass('projectId')">
          <span class="field-label">项目 *</span>
          <LookupSelect :model-value="draft.projectId" :fetch="fetchProjects" recent-key="finance-current-project" placeholder="检索项目" @update:model-value="patch('projectId', $event)" />
          <span v-if="fieldErrors?.projectId" class="field-error">{{ fieldErrors.projectId }}</span>
        </div>
        <div class="field-block" :class="fieldClass('supplierId')">
          <span class="field-label">往来分供方 *</span>
          <LookupSelect :model-value="draft.supplierId" :fetch="fetchSuppliers" recent-key="finance-current-supplier" placeholder="选择分供方（个人临时金也在此建档）" @update:model-value="patch('supplierId', $event)" />
          <p v-if="draft.counterpartyNameSnapshot" class="text-12px text-ink-soft">
            采用时名称：{{ draft.counterpartyNameSnapshot }}
          </p>
          <p v-if="draft.counterparty" class="text-12px text-ink-soft">
            原往来方文字：{{ draft.counterparty }}
          </p>
          <span v-if="fieldErrors?.supplierId" class="field-error">{{ fieldErrors.supplierId }}</span>
        </div>
        <label class="field-block form-span-full">
          <span class="field-label">款项性质</span>
          <input :value="draft.purpose" class="field-input w-full" @input="patch('purpose', inputValue($event))">
        </label>
      </div>
    </section>
    <section id="section-amount" class="panel scroll-mt-4 p-4">
      <SectionHeader>金额与方式</SectionHeader>
      <div class="form-fields-grid mt-3">
        <label class="field-block">
          <span class="field-label">金额 *</span>
          <input :value="draft.amount" type="number" min="0" step="0.01" class="field-input w-full font-mono" :class="[fieldClass('amount')]" data-testid="finance-amount" @input="patch('amount', inputNumber($event))">
          <span v-if="fieldErrors?.amount" class="field-error">{{ fieldErrors.amount }}</span>
        </label>
        <div class="field-block">
          <span class="field-label">收付方式</span>
          <SelectFilter :model-value="draft.paymentMethod" :options="PAYMENT_METHOD_OPTIONS" full-width aria-label="收付方式" @update:model-value="patch('paymentMethod', $event)" />
        </div>
        <label class="field-block">
          <span class="field-label">日期 *</span>
          <input :value="draft.transactionDate" type="date" class="field-input w-full" :class="[fieldClass('transactionDate')]" data-testid="finance-date" @input="patch('transactionDate', inputValue($event))">
          <span v-if="fieldErrors?.transactionDate" class="field-error">{{ fieldErrors.transactionDate }}</span>
        </label>
        <label class="field-block">
          <span class="field-label">银行流水号</span>
          <input :value="draft.bankSerialNo" class="field-input w-full font-mono" @input="patch('bankSerialNo', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">经办人</span>
          <input :value="draft.handler" class="field-input w-full" @input="patch('handler', inputValue($event))">
        </label>
      </div>
    </section>
  </template>

  <template v-else>
    <section id="section-basic" class="panel scroll-mt-4 p-4">
      <SectionHeader>基本信息</SectionHeader>
      <div class="form-fields-grid mt-3">
        <label class="field-block">
          <span class="field-label">报销单号</span>
          <input :value="draft.no" class="field-input w-full font-mono" data-testid="finance-no" @input="patch('no', inputValue($event))">
        </label>
        <div class="field-block">
          <span class="field-label">报销／垫付身份 *</span>
          <SelectFilter :model-value="applicantKind" :options="APPLICANT_KIND_OPTIONS" full-width aria-label="报销身份类型" @update:model-value="changeApplicantKind" />
          <LookupSelect v-if="applicantKind === 'worker' && fetchWorkers" :model-value="draft.applicantWorkerId" :fetch="fetchWorkers" recent-key="finance-reimbursement-worker" placeholder="从全局工人清单选择" @update:model-value="patch('applicantWorkerId', $event)" />
          <LookupSelect v-else-if="applicantKind === 'supplier'" :model-value="draft.applicantSupplierId" :fetch="fetchSuppliers" recent-key="finance-reimbursement-applicant-supplier" placeholder="选择垫付分供方" @update:model-value="patch('applicantSupplierId', $event)" />
          <p v-if="draft.applicantNameSnapshot" class="text-12px text-ink-soft">
            采用时姓名：{{ draft.applicantNameSnapshot }}
          </p>
          <p v-if="draft.applicant" class="text-12px text-ink-soft">
            原报销人文字：{{ draft.applicant }}
          </p>
          <span v-if="fieldErrors?.applicantWorkerId" class="field-error">{{ fieldErrors.applicantWorkerId }}</span>
        </div>
        <div v-if="fetchConstructionMains && (!draft.id || (draft.status === 'draft' && draft.constructionMain))" class="field-block">
          <span class="field-label">工程名称 *</span>
          <LookupSelect :model-value="draft.constructionMain?.id ?? null" :fetch="fetchConstructionMains" placeholder="搜索工程名称、施工合同名称或编号" @update:model-value="selectEngineering" />
          <p class="text-12px text-ink-soft">
            费用与工程归属一起保存；共用费用分明细，本单各行须属于同一实际工程。
          </p>
        </div>
        <div v-else class="field-block">
          <span class="field-label">原归属项目</span>
          <LookupSelect :model-value="draft.projectId" :fetch="fetchProjects" recent-key="finance-reimbursement-project" placeholder="核对原实际项目；历史无项目记录保留" @update:model-value="patch('projectId', $event)" />
        </div>
        <label class="field-block">
          <span class="field-label">费用类别</span>
          <input :value="draft.category" class="field-input w-full" @input="patch('category', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">报销日期 *</span>
          <input :value="draft.reimbursementDate" type="date" class="field-input w-full" :class="[fieldClass('reimbursementDate')]" data-testid="finance-date" @input="patch('reimbursementDate', inputValue($event))">
          <span v-if="fieldErrors?.reimbursementDate" class="field-error">{{ fieldErrors.reimbursementDate }}</span>
        </label>
        <label class="field-block">
          <span class="field-label">发票张数</span>
          <input :value="draft.invoiceCount" type="number" min="0" step="1" class="field-input w-full" @input="patch('invoiceCount', inputNumber($event))">
        </label>
        <label class="field-block form-span-full">
          <span class="field-label">报销事由</span>
          <textarea :value="draft.reason" rows="2" class="field-input w-full" @input="patch('reason', inputValue($event))" />
        </label>
      </div>
    </section>
    <section id="section-lines" class="panel scroll-mt-4 overflow-hidden" :class="fieldClass('lines')">
      <div class="border-b border-line px-4 py-3">
        <SectionHeader>费用明细</SectionHeader>
      </div>
      <FinanceLineGrid
        kind="reimbursement"
        :lines="draft.lines ?? []"
        :fetch-counterparties="fetchSuppliers"
        :fetch-original-expenses="fetchOriginalExpenses"
        :fetch-construction-mains="fetchConstructionMains"
        :default-construction-main="draft.constructionMain"
        :total-label="`合计 ¥ ${financeDraftMoney(reimbursementTotal)}`"
        empty="暂无明细，请新增一行"
        @update="updateLines"
      />
      <p v-if="fieldErrors?.lines" class="field-error px-4 pb-3">
        {{ fieldErrors.lines }}
      </p>
    </section>
  </template>
</template>
