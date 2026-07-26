<script setup lang="ts">
import type { LookupOption } from '~/lib/kit/lookup'
import type { MaterialFormKind } from '~/lib/material/forms'
import type { MaterialPageDraft } from '~/lib/material/page'
import { computed } from 'vue'

type FieldType = 'text' | 'date' | 'number' | 'lookup' | 'select' | 'readonly' | 'textarea'
type LookupKey
  = | 'projectId'
    | 'customerId'
    | 'supplierId'
    | 'contractId'
    | 'requisitionId'
    | 'crewId'

interface FieldDef {
  key: string
  label: string
  section: string
  type?: FieldType
  required?: boolean
  placeholder?: string
  options?: string[]
  step?: string
  suffix?: string
}

const props = defineProps<{
  kind: MaterialFormKind
  draft: MaterialPageDraft
  fieldErrors: Record<string, string>
  readonly?: boolean
  fetchProjects: (keyword: string) => Promise<LookupOption[]>
  fetchCustomers: (keyword: string) => Promise<LookupOption[]>
  fetchSuppliers: (keyword: string) => Promise<LookupOption[]>
  fetchContracts: (keyword: string) => Promise<LookupOption[]>
  fetchRequisitions: (keyword: string) => Promise<LookupOption[]>
  fetchCrews: (keyword: string) => Promise<LookupOption[]>
}>()

const emit = defineEmits<{
  patch: [patch: Partial<MaterialPageDraft>]
  clearError: [field: string]
}>()

const WAREHOUSES = ['中心仓', '合和新城现场仓']

const FIELDS: Record<MaterialFormKind, FieldDef[]> = {
  mat_requisition: [
    { key: 'no', label: '下料单编号', section: 'basic', placeholder: '留空自动生成' },
    { key: 'projectId', label: '项目', section: 'basic', type: 'lookup', required: true },
    { key: 'contractId', label: '材料采购合同', section: 'basic', type: 'lookup' },
    { key: 'applicant', label: '申请人', section: 'basic', required: true },
    { key: 'requisitionDate', label: '下料日期', section: 'basic', type: 'date', required: true },
    { key: 'requiredDate', label: '需用日期', section: 'basic', type: 'date' },
    { key: 'materialName', label: '材料名称', section: 'material', required: true },
    { key: 'spec', label: '规格型号', section: 'material' },
    { key: 'unit', label: '单位', section: 'material', required: true },
    { key: 'plannedQty', label: '计划量', section: 'material', type: 'number', step: '0.001', required: true },
    { key: 'arrivedQty', label: '已到量（派生）', section: 'material', type: 'readonly', suffix: '由已入库到货明细聚合' },
    { key: 'remainingQty', label: '剩余未到（派生）', section: 'material', type: 'readonly', suffix: '计划量 − 已到量' },
    { key: 'warehouse', label: '到货仓库', section: 'material', type: 'select', options: WAREHOUSES },
    { key: 'purpose', label: '用途', section: 'material', type: 'textarea' },
  ],
  mat_arrival: [
    { key: 'no', label: '到货单号', section: 'basic', placeholder: '留空自动生成' },
    { key: 'projectId', label: '项目', section: 'basic', type: 'lookup', required: true },
    { key: 'supplierId', label: '分供方', section: 'basic', type: 'lookup', required: true },
    { key: 'contractId', label: '采购合同', section: 'basic', type: 'lookup' },
    { key: 'requisitionId', label: '关联下料单', section: 'basic', type: 'lookup' },
    { key: 'warehouse', label: '到货仓库', section: 'basic', type: 'select', options: WAREHOUSES, required: true },
    { key: 'arrivalDate', label: '到货日期', section: 'basic', type: 'date', required: true },
    { key: 'receiver', label: '收货人', section: 'basic' },
    { key: 'qualityResult', label: '质检结论', section: 'quality', type: 'select', options: ['合格', '待检'] },
    { key: 'stockStatus', label: '入库状态', section: 'quality', type: 'readonly', suffix: '执行入库动作后自动变为已入库' },
  ],
  mat_use: [
    { key: 'no', label: '领用单号', section: 'basic', placeholder: '留空自动生成' },
    { key: 'projectId', label: '项目', section: 'basic', type: 'lookup', required: true },
    { key: 'warehouse', label: '领用仓库', section: 'basic', type: 'select', options: WAREHOUSES, required: true },
    { key: 'useDate', label: '领用日期', section: 'basic', type: 'date', required: true },
    { key: 'materialName', label: '材料名称', section: 'material', required: true },
    { key: 'spec', label: '规格型号', section: 'material' },
    { key: 'unit', label: '单位', section: 'material', required: true },
    { key: 'qty', label: '领用数量', section: 'material', type: 'number', step: '0.001', required: true },
    { key: 'receiver', label: '领用人', section: 'material', required: true },
    { key: 'crewId', label: '领用班组', section: 'material', type: 'lookup' },
    { key: 'purpose', label: '用途', section: 'material', type: 'textarea' },
  ],
  stock_check: [
    { key: 'no', label: '盘点编号', section: 'basic', placeholder: '留空自动生成' },
    { key: 'warehouse', label: '仓库', section: 'basic', type: 'select', options: WAREHOUSES, required: true },
    { key: 'checker', label: '盘点人', section: 'basic', required: true },
    { key: 'checkDate', label: '盘点日期', section: 'basic', type: 'date', required: true },
  ],
  owner_control: [
    { key: 'no', label: '总控编号', section: 'basic', placeholder: '留空自动生成' },
    { key: 'projectId', label: '项目', section: 'basic', type: 'lookup', required: true },
    { key: 'customerId', label: '甲供单位', section: 'basic', type: 'lookup', required: true },
    { key: 'materialName', label: '甲供材料', section: 'material', required: true },
    { key: 'spec', label: '规格型号', section: 'material' },
    { key: 'unit', label: '单位', section: 'material', required: true },
    { key: 'controlQty', label: '总控量', section: 'material', type: 'number', step: '0.001', required: true },
    { key: 'arrivedQty', label: '累计到货（派生）', section: 'material', type: 'readonly' },
    { key: 'usedQty', label: '累计领用（派生）', section: 'material', type: 'readonly' },
    { key: 'remainingQty', label: '剩余可用（派生）', section: 'material', type: 'readonly', suffix: '总控量 − 累计领用' },
    { key: 'stockQty', label: '在库量（派生）', section: 'material', type: 'readonly', suffix: '入库到货 − 仓库领用' },
  ],
  owner_requisition: [
    { key: 'no', label: '下料单编号', section: 'basic', placeholder: '留空自动生成' },
    { key: 'projectId', label: '项目', section: 'basic', type: 'lookup', required: true },
    { key: 'applicant', label: '申请人', section: 'basic', required: true },
    { key: 'applicationDate', label: '申请日期', section: 'basic', type: 'date', required: true },
    { key: 'requiredDate', label: '需用日期', section: 'basic', type: 'date' },
    { key: 'materialName', label: '甲供材料', section: 'material', required: true },
    { key: 'spec', label: '规格型号', section: 'material' },
    { key: 'unit', label: '单位', section: 'material', required: true },
    { key: 'plannedQty', label: '计划量', section: 'material', type: 'number', step: '0.001', required: true },
  ],
  owner_arrival: [
    { key: 'no', label: '到货单号', section: 'basic', placeholder: '留空自动生成' },
    { key: 'projectId', label: '项目', section: 'basic', type: 'lookup', required: true },
    { key: 'warehouse', label: '仓库', section: 'basic', type: 'select', options: WAREHOUSES, required: true },
    { key: 'arrivalDate', label: '到货日期', section: 'basic', type: 'date', required: true },
    { key: 'receiver', label: '收货人', section: 'basic' },
    { key: 'materialName', label: '甲供材料', section: 'material', required: true },
    { key: 'spec', label: '规格型号', section: 'material' },
    { key: 'unit', label: '单位', section: 'material', required: true },
    { key: 'qty', label: '到货数量', section: 'material', type: 'number', step: '0.001', required: true },
    { key: 'qualityResult', label: '质检结论', section: 'material', type: 'select', options: ['合格', '待检'] },
    { key: 'stockStatus', label: '入库状态', section: 'material', type: 'readonly', suffix: '执行入库动作后自动变为已入库' },
  ],
  owner_use: [
    { key: 'no', label: '领用单号', section: 'basic', placeholder: '留空自动生成' },
    { key: 'projectId', label: '项目', section: 'basic', type: 'lookup', required: true },
    { key: 'useDate', label: '领用日期', section: 'basic', type: 'date', required: true },
    { key: 'materialName', label: '甲供材料', section: 'material', required: true },
    { key: 'unit', label: '单位', section: 'material', required: true },
    { key: 'qty', label: '领用数量', section: 'material', type: 'number', step: '0.001', required: true },
    { key: 'receiver', label: '领用人', section: 'material', required: true },
    { key: 'crewId', label: '领用班组', section: 'material', type: 'lookup' },
    { key: 'purpose', label: '用途', section: 'material', type: 'textarea' },
  ],
  owner_direct: [
    { key: 'no', label: '单据编号', section: 'basic', placeholder: '留空自动生成' },
    { key: 'projectId', label: '项目', section: 'basic', type: 'lookup', required: true },
    { key: 'customerId', label: '甲供单位', section: 'basic', type: 'lookup', required: true },
    { key: 'transactionDate', label: '日期', section: 'basic', type: 'date', required: true },
    { key: 'materialName', label: '甲供材料', section: 'material', required: true },
    { key: 'unit', label: '单位', section: 'material', required: true },
    { key: 'qty', label: '数量', section: 'material', type: 'number', step: '0.001', required: true },
    { key: 'purpose', label: '用途', section: 'material' },
    { key: 'useLocation', label: '使用部位', section: 'material', required: true },
  ],
}

const fields = computed(() => FIELDS[props.kind])
const sectionKeys = computed(() => [...new Set(fields.value.map(field => field.section))])

function patch(key: string, value: unknown) {
  emit('patch', { [key]: value })
  emit('clearError', key)
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}

function numberValue(event: Event): number | null {
  const value = inputValue(event).trim()
  if (!value)
    return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function lookupFor(key: string): (keyword: string) => Promise<LookupOption[]> {
  const lookupKey = key as LookupKey
  return {
    projectId: props.fetchProjects,
    customerId: props.fetchCustomers,
    supplierId: props.fetchSuppliers,
    contractId: props.fetchContracts,
    requisitionId: props.fetchRequisitions,
    crewId: props.fetchCrews,
  }[lookupKey]
}

function disabledReason(key: string): string | undefined {
  if (props.readonly)
    return '已生效单据不可修改'
  if (key === 'contractId' || key === 'requisitionId')
    return props.draft.projectId ? undefined : '请先选择项目'
  return undefined
}

function readonlyValue(field: FieldDef): string | number {
  const value = props.draft[field.key]
  if (field.key === 'stockStatus') {
    return {
      pending: '待入库',
      stored: '已入库',
    }[String(value ?? '')] ?? String(value ?? '待入库')
  }
  return typeof value === 'string' || typeof value === 'number' ? value : 0
}
</script>

<template>
  <section
    v-for="section in sectionKeys"
    :id="`section-${section}`"
    :key="section"
    class="panel scroll-mt-4 p-4"
  >
    <SectionHeader :title="section === 'basic' ? '基本信息' : section === 'quality' ? '质检与入库' : '材料信息'" />
    <div class="form-fields-grid mt-3">
      <template v-for="field in fields.filter(item => item.section === section)" :key="field.key">
        <div v-if="field.type === 'lookup'" class="field-block">
          <span class="field-label">{{ field.label }}<span v-if="field.required"> *</span></span>
          <LookupSelect
            :data-testid="`material-${field.key}`"
            :model-value="typeof draft[field.key] === 'string' ? draft[field.key] as string : null"
            :fetch="lookupFor(field.key)"
            :recent-key="`material-${kind}-${field.key}`"
            :disabled-reason="disabledReason(field.key)"
            :placeholder="`检索${field.label}`"
            @update:model-value="patch(field.key, $event)"
          />
          <span v-if="fieldErrors[field.key]" class="field-error">{{ fieldErrors[field.key] }}</span>
        </div>

        <div v-else-if="field.type === 'select'" class="field-block">
          <span class="field-label">{{ field.label }}<span v-if="field.required"> *</span></span>
          <SelectFilter
            :data-testid="`material-${field.key}`"
            :model-value="String(draft[field.key] ?? '')"
            :options="(field.options ?? []).map(option => ({ key: option, label: option }))"
            :disabled="readonly"
            full-width
            :aria-label="field.label"
            @update:model-value="patch(field.key, $event)"
          />
          <span v-if="fieldErrors[field.key]" class="field-error">{{ fieldErrors[field.key] }}</span>
        </div>

        <div v-else-if="field.type === 'readonly'" class="field-block">
          <span class="field-label">{{ field.label }}</span>
          <div
            :data-testid="`material-${field.key}`"
            class="field-input flex min-h-8 items-center bg-surface-2 font-mono font-700 text-ink"
          >
            {{ readonlyValue(field) }}
          </div>
          <span v-if="field.suffix" class="field-hint">{{ field.suffix }}</span>
        </div>

        <label v-else class="field-block" :class="{ 'form-span-full': field.type === 'textarea' }">
          <span class="field-label">{{ field.label }}<span v-if="field.required"> *</span></span>
          <textarea
            v-if="field.type === 'textarea'"
            :data-testid="`material-${field.key}`"
            :value="String(draft[field.key] ?? '')"
            rows="3"
            class="field-input w-full"
            :placeholder="field.placeholder"
            :disabled="readonly"
            @input="patch(field.key, inputValue($event))"
          />
          <input
            v-else
            :data-testid="`material-${field.key}`"
            :value="draft[field.key] ?? ''"
            :type="field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'"
            :step="field.step"
            :min="field.type === 'number' ? '0' : undefined"
            class="field-input w-full"
            :class="{ 'font-mono': field.type === 'number' || field.type === 'date' || field.key === 'no' }"
            :placeholder="field.placeholder"
            :disabled="readonly"
            @input="patch(field.key, field.type === 'number' ? numberValue($event) : inputValue($event))"
          >
          <span v-if="fieldErrors[field.key]" class="field-error">{{ fieldErrors[field.key] }}</span>
        </label>
      </template>
    </div>
  </section>
</template>
