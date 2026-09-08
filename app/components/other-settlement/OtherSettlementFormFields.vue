<script setup lang="ts">
import type { OtherSettlementContract, OtherSettlementDraft } from '~/lib/other-settlement/contract'
import { auxiliaryMoney } from '~/lib/auxiliary-contract/presentation'

const props = defineProps<{
  draft: OtherSettlementDraft
  errors: Record<string, string>
  contract?: OtherSettlementContract
  supplierLabel?: string
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
  patch: [
        value: Partial<OtherSettlementDraft>,
  ]
}>()
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
    <div class="mt-3 grid min-w-0 gap-4 md:grid-cols-2">
      <div class="min-w-0">
        <label class="mb-2 block text-13px">项目 *</label>
        <LookupSelect v-model="project" :fetch="fetchProjects" placeholder="检索项目" />
        <p v-if="errors.projectId" class="text-12px text-danger">
          {{ errors.projectId }}
        </p>
      </div>
      <div class="min-w-0">
        <label class="mb-2 block text-13px">其他支出合同 *</label>
        <LookupSelect :key="project" v-model="contractId" :fetch="fetchContracts" placeholder="检索其他支出合同" />
        <p class="text-12px text-ink-soft">
          仅可选择同项目、非草稿的其他支出合同。
        </p>
        <p v-if="errors.contractId" class="text-12px text-danger">
          {{ errors.contractId }}
        </p>
      </div>
      <label v-for="field in fields" :key="field.key" class="min-w-0 text-13px">
        {{ field.label }}{{ 'required' in field && field.required ? ' *' : '' }}
        <input :value="draft[field.key] ?? ''" :type="field.type" :step="field.type === 'number' ? '0.01' : undefined" :min="field.type === 'number' ? '0' : undefined" class="field-input mt-2 w-full min-w-0" :aria-invalid="Boolean(errors[field.key])" @input="input(field.key, $event)">
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
      <template v-else>
        尚未选择有效源合同；请先在<NuxtLink to="/contract/other-expense" class="text-brand underline">
          其他支出合同
        </NuxtLink>中建立并提交同项目合同。
      </template>
    </div>
  </section>
</template>
