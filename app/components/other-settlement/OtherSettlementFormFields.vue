<script setup lang="ts">
import type { ExpenseClearanceSourceDTO } from '~/lib/finance/clearance-verification'
import type { OtherSettlementContract, OtherSettlementDraft } from '~/lib/other-settlement/contract'
import { auxiliaryMoney } from '~/lib/auxiliary-contract/presentation'

const props = defineProps<{
  draft: OtherSettlementDraft
  errors: Record<string, string>
  contract?: OtherSettlementContract
  supplierLabel?: string
  expenses?: ExpenseClearanceSourceDTO[]
  expenseError?: string
  fetchProjects: (keyword: string) => Promise<Array<{
    id: string
    label: string
  }>>
  fetchContracts: (keyword: string) => Promise<Array<{
    id: string
    label: string
  }>>
}>()
const emit = defineEmits<{
  reloadExpenses: [
  ]
  patch: [
        value: Partial<OtherSettlementDraft>,
  ]
}>()
const mode = ref(props.draft.contractId ? 'contract' : 'expense')
watch(() => props.draft.contractId, (value) => {
  if (value)
    mode.value = 'contract'
}, { immediate: true })
const candidates = computed(() => (props.expenses ?? []).filter(row => row.projectId === (props.draft.projectId || null)))
function expenseChange(id: string, checked: boolean) {
  const source = candidates.value.find(row => row.id === id)
  if (!source)
    return
  const originalExpenses = checked ? [...(props.draft.originalExpenses ?? []), { originalExpenseLineId: id, sourceVersion: source.version, sourceRevision: source.sourceRevision, amount: source.qualification.newAdoptableAmount }] : (props.draft.originalExpenses ?? []).filter(row => row.originalExpenseLineId !== id)
  const first = candidates.value.find(row => row.id === originalExpenses[0]?.originalExpenseLineId)
  emit('patch', { originalExpenses, totalAmount: originalExpenses.some(row => row.amount === null) ? null : originalExpenses.reduce((sum, row) => sum + Math.round(row.amount! * 100), 0) / 100, payeeWorkerId: first?.applicantWorkerId ?? null, payeeSupplierId: first?.applicantSupplierId ?? null, payeeNameSnapshot: first?.applicantNameSnapshot ?? null })
}
function allocationAmount(id: string, event: Event) {
  const value = (event.target as HTMLInputElement).value
  const originalExpenses = (props.draft.originalExpenses ?? []).map(row => row.originalExpenseLineId === id ? { ...row, amount: value === '' ? null : Number(value) } : row)
  emit('patch', { originalExpenses, totalAmount: originalExpenses.some(row => row.amount === null) ? null : originalExpenses.reduce((sum, row) => sum + Math.round(row.amount! * 100), 0) / 100 })
}
function changeMode(event: Event) {
  mode.value = (event.target as HTMLSelectElement).value
  emit('patch', { contractId: null })
}
const project = computed({ get: () => props.draft.projectId ?? '', set: value => emit('patch', { projectId: value }) })
const contractId = computed({ get: () => props.draft.contractId ?? '', set: value => emit('patch', { contractId: value }) })
const fields = [
  { key: 'no', label: '结算单号', type: 'text' },
  { key: 'name', label: '结算名称', type: 'text', required: true },
  { key: 'totalAmount', label: '含税结算金额', type: 'number', required: true },
  { key: 'taxRate', label: '税率（%）', type: 'number' },
  { key: 'settlementDate', label: '结算日期', type: 'date', required: true },
  { key: 'period', label: '结算期间', type: 'text' },
  { key: 'deductionNote', label: '扣减说明', type: 'text' },
] as const
function input(key: typeof fields[number]['key'], event: Event) {
  const value = (event.target as HTMLInputElement).value
  emit('patch', { [key]: key === 'totalAmount' || key === 'taxRate' ? value === '' ? null : Number(value) : value })
}
</script>

<template>
  <section id="basic" class="panel min-w-0 p-4">
    <SectionHeader title="结算资料" />
    <label class="mt-3 block text-13px">结算来源<select :value="mode" class="field-input ml-2 max-w-full" @change="changeMode"><option value="expense">无合同原费用采用</option><option value="contract">其他支出合同</option></select></label>
    <div class="mt-3 grid min-w-0 gap-4 md:grid-cols-2">
      <div class="min-w-0">
        <label class="mb-2 block text-13px">{{ mode === 'contract' ? '项目 *' : '项目（留空为公司归属）' }}</label>
        <LookupSelect v-model="project" field="projectId" :invalid="Boolean(errors.projectId)" description-id="settlement-project-error" :fetch="fetchProjects" placeholder="检索项目" />
        <KitButton v-if="mode === 'expense' && draft.projectId" class="mt-2" @click="emit('patch', { projectId: null })">
          采用公司归属
        </KitButton>
        <p v-if="errors.projectId" id="settlement-project-error" class="text-12px text-danger">
          {{ errors.projectId }}
        </p>
      </div>
      <div v-if="mode === 'contract'" class="min-w-0">
        <label class="mb-2 block text-13px">其他支出合同 *</label>
        <LookupSelect :key="project" v-model="contractId" field="contractId" :invalid="Boolean(errors.contractId)" description-id="settlement-contract-error" :fetch="fetchContracts" placeholder="检索其他支出合同" />
        <p class="text-12px text-ink-soft">
          仅可选择同项目、非草稿的其他支出合同。
        </p>
        <p v-if="errors.contractId" id="settlement-contract-error" class="text-12px text-danger">
          {{ errors.contractId }}
        </p>
      </div>
      <label v-for="field in fields" :key="field.key" class="min-w-0 text-13px">
        {{ field.label }}{{ 'required' in field && field.required ? ' *' : '' }}
        <input :value="draft[field.key] ?? ''" :readonly="mode === 'expense' && field.key === 'totalAmount'" :type="field.type" :step="field.type === 'number' ? '0.01' : undefined" :min="field.type === 'number' ? '0' : undefined" class="field-input mt-2 w-full min-w-0" :aria-invalid="Boolean(errors[field.key])" @input="input(field.key, $event)">
        <span v-if="errors[field.key]" class="mt-1 block text-12px text-danger">{{ errors[field.key] }}</span>
      </label>
      <label class="text-13px">结算类型
        <select :value="draft.settlementType" class="field-input mt-2 w-full" @change="emit('patch', { settlementType: ($event.target as HTMLSelectElement).value })">
          <option>过程结算</option><option>完工结算</option><option>零星用工</option>
        </select>
      </label>
    </div>
    <div class="mt-4 rounded bg-surface-2 p-3 text-13px leading-7">
      <template v-if="contract">
        分供方：{{ supplierLabel || '关系不可用' }} · 原合同金额 {{ auxiliaryMoney(contract.amount) }} · 变更后合同金额 {{ auxiliaryMoney(contract.changedAmount) }}
      </template>
      <template v-else-if="mode === 'contract'">
        尚未选择有效源合同；请先在<NuxtLink to="/contract/other-expense" class="text-brand underline">
          其他支出合同
        </NuxtLink>中建立并提交同项目合同。
      </template>
      <template v-else>
        实际垫付收款人：{{ draft.payeeNameSnapshot || '选择原费用后继承' }}；服务交易方随各原费用冻结。未知采用金额只保存草稿。
      </template>
    </div>
    <section v-if="mode === 'expense'" class="mt-4 min-w-0" aria-label="采用真实原费用">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="m-0 text-14px">
          已确认原费用
        </h3><KitButton @click="emit('reloadExpenses')">
          重新核对原费用来源
        </KitButton>
      </div>
      <p v-if="expenseError" role="alert" class="text-13px text-danger">
        {{ expenseError }}
      </p>
      <p v-else-if="!candidates.length" class="text-13px text-ink-soft">
        当前归属没有可采用的已确认原费用。
      </p>
      <div v-for="source in candidates" :key="source.id" class="mt-3 grid min-w-0 gap-2 rounded border border-line p-3 text-13px md:grid-cols-[minmax(0,1fr)_160px]">
        <label class="min-w-0 break-words"><input type="checkbox" :checked="draft.originalExpenses?.some(row => row.originalExpenseLineId === source.id)" :disabled="!['not-required', 'verified'].includes(source.qualification.state)" :aria-label="`采用原费用 ${source.expenseItem}`" @change="expenseChange(source.id, ($event.target as HTMLInputElement).checked)"> {{ source.expenseItem }} · 原额 ¥{{ source.amount.toFixed(2) }}<span class="mt-1 block break-all text-ink-soft">原费行 {{ source.id }} · 服务方 {{ source.serviceSupplierNameSnapshot }} · 垫付人 {{ source.applicantNameSnapshot }}</span><span class="block">可新增采用：{{ source.qualification.newAdoptableAmount === null ? '待核实' : `¥${source.qualification.newAdoptableAmount.toFixed(2)}` }} · {{ source.qualification.message }}</span><NuxtLink v-if="source.qualification.state !== 'not-required'" :to="`/finance/reimbursement/${source.headerId}?origin=real`" class="block text-brand underline">查看或完成旧清偿替代核验</NuxtLink></label>
        <label v-if="draft.originalExpenses?.some(row => row.originalExpenseLineId === source.id)">本次总采用金额<input type="number" step="0.01" min="0" :max="source.amount" :value="draft.originalExpenses.find(row => row.originalExpenseLineId === source.id)?.amount ?? ''" class="field-input mt-2 w-full" :aria-label="`原费用 ${source.expenseItem} 采用金额`" @input="allocationAmount(source.id, $event)"></label>
      </div>
      <p v-if="errors.originalExpenses" role="alert" class="text-13px text-danger">
        {{ errors.originalExpenses }}
      </p>
    </section>
  </section>
</template>
