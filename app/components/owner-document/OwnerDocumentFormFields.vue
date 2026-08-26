<script setup lang="ts">
import type { LookupOption } from '~/lib/kit/lookup'
import type { OwnerDocumentDraft, OwnerDocumentKind } from '~/lib/owner-document/forms'
import { computed } from 'vue'
import { OWNER_DOCUMENT_META } from '~/lib/owner-document/page'

type FieldType = 'text' | 'date' | 'month' | 'number' | 'lookup' | 'select' | 'readonly' | 'textarea'
type LookupKey = 'projectId' | 'supplierId' | 'contractId' | 'crewId'

interface FieldDef {
  key: string
  label: string
  type?: FieldType
  required?: boolean
  placeholder?: string
  options?: Array<{ key: string, label: string }>
  hint?: string
  step?: string
}

const props = defineProps<{
  kind: OwnerDocumentKind
  draft: OwnerDocumentDraft
  fieldErrors: Record<string, string>
  eligibleContractCount?: number | null
  readonly?: boolean
  fetchProjects: (keyword: string) => Promise<LookupOption[]>
  fetchSuppliers: (keyword: string) => Promise<LookupOption[]>
  fetchContracts: (keyword: string) => Promise<LookupOption[]>
  fetchCrews: (keyword: string) => Promise<LookupOption[]>
}>()

const emit = defineEmits<{
  patch: [patch: Partial<OwnerDocumentDraft>]
  clearError: [field: string]
}>()

const FIELDS: Record<OwnerDocumentKind, FieldDef[]> = {
  owner_change: [
    { key: 'no', label: '变更编号', placeholder: '留空自动生成' },
    { key: 'name', label: '变更名称', required: true },
    { key: 'projectId', label: '项目', type: 'lookup', required: true },
    { key: 'contractId', label: '施工合同', type: 'lookup', required: true },
    {
      key: 'documentType',
      label: '单据类型',
      type: 'select',
      options: [
        { key: 'change_negotiation', label: '变更洽商' },
        { key: 'site_visa', label: '现场签证' },
        { key: 'claim', label: '索赔' },
        { key: 'material_price_approval', label: '材料认价' },
      ],
      required: true,
    },
    { key: 'directiveNo', label: '指令编号' },
    {
      key: 'directiveType',
      label: '指令类型',
      type: 'select',
      options: [
        { key: '', label: '无' },
        { key: 'issued', label: '下发' },
        { key: 'changed', label: '变更' },
        { key: 'supplemented', label: '补充' },
      ],
    },
    { key: 'applicationDate', label: '申报日期', type: 'date', required: true },
    { key: 'approvedTaxInclusiveAmount', label: '审定含税金额', type: 'number', step: '0.01' },
    { key: 'approvedTaxExclusiveAmount', label: '审定不含税金额', type: 'number', step: '0.01' },
    { key: 'appliedTaxExclusiveAmount', label: '申报不含税金额', type: 'number', step: '0.01' },
    { key: 'totalAmount', label: '量价变更金额', type: 'readonly', hint: '由变更明细实时计算' },
    { key: 'reason', label: '变更事由', type: 'textarea', required: true },
    { key: 'statusNote', label: '状态说明', type: 'textarea' },
  ],
  owner_report: [
    { key: 'no', label: '报量编号', placeholder: '留空自动生成' },
    { key: 'projectId', label: '项目', type: 'lookup', required: true },
    { key: 'contractId', label: '施工合同', type: 'lookup', required: true },
    { key: 'periodNo', label: '报量期次', type: 'month', required: true },
    { key: 'applicationDate', label: '申报日期', type: 'date', required: true },
    { key: 'operatorName', label: '报量经办人', placeholder: '用于申报快照审计' },
    { key: 'reportedAmount', label: '申报金额', type: 'readonly' },
    { key: 'auditedAmount', label: '审定金额', type: 'readonly' },
    { key: 'auditDifference', label: '审定差额', type: 'readonly' },
  ],
  acceptance: [
    { key: 'no', label: '单据编号', placeholder: '留空自动生成' },
    { key: 'name', label: '名称', required: true },
    { key: 'projectId', label: '项目', type: 'lookup', required: true },
    { key: 'contractId', label: '施工合同', type: 'lookup', required: true },
    { key: 'applicationDate', label: '申报日期', type: 'date', required: true },
    { key: 'contractEstimate', label: '合同估算金额', type: 'number', step: '0.01' },
    { key: 'acceptanceOrganization', label: '验收单位', hint: '确认验收时必填' },
    { key: 'acceptancePerson', label: '验收人', hint: '确认验收时必填' },
    { key: 'acceptanceDate', label: '验收日期', type: 'date', hint: '确认验收时必填' },
    { key: 'acceptanceConclusion', label: '验收结论', type: 'textarea', hint: '确认验收时必填' },
    { key: 'warrantyOwner', label: '保修责任单位', hint: '进入保修时必填' },
    { key: 'warrantyStartDate', label: '保修开始日期', type: 'date', hint: '进入保修时必填' },
    { key: 'warrantyEndDate', label: '保修结束日期', type: 'date', hint: '进入保修时必填' },
    { key: 'warrantyConfirmationOrganization', label: '到期验收单位', hint: '确认保修到期时必填' },
    { key: 'warrantyConfirmationDate', label: '到期确认日期', type: 'date', hint: '确认保修到期时必填' },
    { key: 'warrantyConfirmationNote', label: '到期确认结论', type: 'textarea', hint: '确认保修到期时必填' },
  ],
  final_settlement: [
    { key: 'no', label: '结算编号', placeholder: '留空自动生成' },
    { key: 'name', label: '结算名称', required: true },
    { key: 'projectId', label: '项目', type: 'lookup', required: true },
    { key: 'contractId', label: '施工合同', type: 'lookup' },
    { key: 'settlementAmount', label: '结算金额', type: 'number', step: '0.01', required: true },
    { key: 'submissionDate', label: '报审日期', type: 'date', required: true },
    { key: 'changedContractAmount', label: '变更后合同额', type: 'readonly' },
    { key: 'receivedAmount', label: '已收款', type: 'readonly' },
    { key: 'settlementReceiptGap', label: '结算收款差额', type: 'readonly' },
    { key: 'basis', label: '结算依据', type: 'textarea' },
    { key: 'differenceNote', label: '差额说明', type: 'textarea' },
  ],
  owner_penalty: [
    { key: 'no', label: '罚扣编号', placeholder: '留空自动生成' },
    { key: 'projectId', label: '项目', type: 'lookup', required: true },
    { key: 'contractId', label: '施工合同', type: 'lookup', required: true },
    { key: 'noticeNo', label: '甲方通知编号' },
    { key: 'amount', label: '罚扣金额', type: 'number', step: '0.01', required: true },
    { key: 'penaltyDate', label: '罚扣日期', type: 'date', required: true },
    { key: 'reason', label: '罚扣事由', type: 'textarea', required: true },
    { key: 'appealNote', label: '申诉说明', type: 'textarea' },
  ],
  sub_change: [
    { key: 'no', label: '变更编号', placeholder: '留空自动生成' },
    {
      key: 'changeType',
      label: '变更类型',
      type: 'select',
      options: [
        { key: '增项', label: '增项' },
        { key: '减项', label: '减项' },
        { key: '签证', label: '签证' },
        { key: '价格调整', label: '价格调整' },
      ],
      required: true,
    },
    { key: 'projectId', label: '项目', type: 'lookup', required: true },
    { key: 'supplierId', label: '分供方', type: 'lookup', required: true },
    { key: 'contractId', label: '分包合同', type: 'lookup', required: true },
    { key: 'changeDate', label: '变更日期', type: 'date', required: true },
    { key: 'approvedAmount', label: '审批金额', type: 'number', step: '0.01', required: true },
    { key: 'changedArea', label: '变更面积', type: 'number', step: '0.001' },
    { key: 'actualApprovedPrice', label: '实际审批单价', type: 'number', step: '0.01' },
    { key: 'reason', label: '变更事由', type: 'textarea', required: true },
  ],
  sub_settlement: [
    { key: 'no', label: '结算编号', placeholder: '留空自动生成' },
    { key: 'name', label: '结算名称', required: true },
    { key: 'projectId', label: '项目', type: 'lookup', required: true },
    { key: 'supplierId', label: '分供方', type: 'lookup', required: true },
    { key: 'contractId', label: '分包合同', type: 'lookup', required: true },
    {
      key: 'settlementType',
      label: '结算类型',
      type: 'select',
      options: [
        { key: '过程结算', label: '过程结算' },
        { key: '最终结算', label: '最终结算' },
      ],
    },
    { key: 'contractAmount', label: '合同金额', type: 'readonly' },
    { key: 'priorSettlementAmount', label: '往期结算', type: 'readonly' },
    { key: 'totalAmount', label: '结算金额', type: 'number', step: '0.01', required: true },
    { key: 'settlementRatio', label: '本次结算占比', type: 'readonly', hint: '本次结算金额 ÷ 合同金额' },
    { key: 'settlementDate', label: '结算日期', type: 'date', required: true },
    { key: 'deductionNote', label: '扣款说明', type: 'textarea' },
  ],
  project_penalty: [
    { key: 'no', label: '罚扣编号', placeholder: '留空自动生成' },
    { key: 'projectId', label: '项目', type: 'lookup', required: true },
    { key: 'supplierId', label: '分供方', type: 'lookup' },
    { key: 'contractId', label: '分包合同', type: 'lookup' },
    { key: 'crewId', label: '责任班组', type: 'lookup' },
    { key: 'penaltyDate', label: '罚扣日期', type: 'date', required: true },
    { key: 'amount', label: '罚扣金额', type: 'number', step: '0.01', required: true },
    {
      key: 'deductionMethod',
      label: '抵扣方式',
      type: 'select',
      options: [
        { key: '结算抵扣', label: '结算抵扣' },
        { key: '工资抵扣', label: '工资抵扣' },
        { key: '现金收缴', label: '现金收缴' },
      ],
    },
    { key: 'deadline', label: '整改期限', type: 'date' },
    { key: 'deductedAmount', label: '已抵扣金额', type: 'readonly' },
    { key: 'remainingDeductionAmount', label: '待抵扣金额', type: 'readonly' },
    { key: 'reason', label: '罚扣事由', type: 'textarea', required: true },
    { key: 'rectificationNote', label: '整改说明', type: 'textarea' },
  ],
}

const fields = computed(() => FIELDS[props.kind])
const meta = computed(() => OWNER_DOCUMENT_META[props.kind])
const basicSectionLabel = computed(() =>
  meta.value.sections.find(section => section.key === 'basic')?.label ?? '基本信息',
)
const hasNoEligibleContract = computed(() =>
  Boolean(props.draft.projectId) && props.eligibleContractCount === 0,
)
const contractEmptyMessage = computed(() => {
  if (props.kind === 'sub_change' || props.kind === 'sub_settlement' || props.kind === 'project_penalty') {
    return props.draft.supplierId
      ? '当前项目与分供方暂无可选的分包合同，请先建立对应合同。'
      : '当前项目暂无可选的分包合同，请先建立对应合同。'
  }
  return '当前项目暂无可选的施工合同，请先建立对应合同。'
})

function patch(key: string, value: unknown) {
  emit('patch', { [key]: value })
  emit('clearError', key)
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}

function inputNumber(event: Event): number | null {
  const value = inputValue(event).trim()
  if (!value)
    return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function errorId(field: string): string {
  return `owner-document-${props.kind}-${field}-error`
}

function errorDescriptionId(field: string): string | undefined {
  return props.fieldErrors[field] ? errorId(field) : undefined
}

function lookupFor(key: string) {
  return {
    projectId: props.fetchProjects,
    supplierId: props.fetchSuppliers,
    contractId: props.fetchContracts,
    crewId: props.fetchCrews,
  }[key as LookupKey]
}

const ACCEPTANCE_LIFECYCLE_FIELDS = new Set([
  'acceptanceOrganization',
  'acceptancePerson',
  'acceptanceDate',
  'acceptanceConclusion',
  'warrantyOwner',
  'warrantyStartDate',
  'warrantyEndDate',
  'warrantyConfirmationOrganization',
  'warrantyConfirmationDate',
  'warrantyConfirmationNote',
])

function acceptanceLifecycleFieldIsEditable(key: string): boolean {
  if (props.kind !== 'acceptance')
    return false
  const status = String(props.draft.status ?? '')
  if (status === 'submitted')
    return ['acceptanceOrganization', 'acceptancePerson', 'acceptanceDate', 'acceptanceConclusion'].includes(key)
  if (status === 'accepted')
    return ['warrantyOwner', 'warrantyStartDate', 'warrantyEndDate'].includes(key)
  if (status === 'warranty') {
    return ['warrantyConfirmationOrganization', 'warrantyConfirmationDate', 'warrantyConfirmationNote'].includes(key)
  }
  return false
}

function fieldIsReadonly(key: string): boolean {
  if (props.kind === 'acceptance' && ACCEPTANCE_LIFECYCLE_FIELDS.has(key))
    return !acceptanceLifecycleFieldIsEditable(key)
  return Boolean(props.readonly)
}

function disabledReason(key: string): string | undefined {
  if (props.kind === 'acceptance' && ACCEPTANCE_LIFECYCLE_FIELDS.has(key) && fieldIsReadonly(key))
    return '该事实只能在对应生命周期命令中填写'
  if (fieldIsReadonly(key))
    return '已生效单据不可修改'
  if (key === 'contractId')
    return props.draft.projectId ? undefined : '请先选择项目'
  return undefined
}

function readonlyValue(field: FieldDef): string {
  const value = props.draft[field.key]
  if (value == null || value === '')
    return '—'
  if (typeof value === 'number')
    return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return String(value)
}
</script>

<template>
  <section id="section-basic" class="panel scroll-mt-4 p-4">
    <SectionHeader :title="basicSectionLabel" />
    <div class="form-fields-grid mt-3">
      <template v-for="field in fields" :key="field.key">
        <div v-if="field.type === 'lookup'" class="field-block">
          <span class="field-label">{{ field.label }}<span v-if="field.required"> *</span></span>
          <LookupSelect
            :data-testid="`owner-document-${field.key}`"
            :model-value="typeof draft[field.key] === 'string' ? draft[field.key] as string : null"
            :fetch="lookupFor(field.key)"
            :field="field.key"
            :invalid="Boolean(fieldErrors[field.key])"
            :description-id="errorDescriptionId(field.key)"
            :recent-key="`owner-document-${kind}-${field.key}`"
            :disabled-reason="disabledReason(field.key)"
            :placeholder="`检索${field.label}`"
            @update:model-value="patch(field.key, $event)"
          />
          <span v-if="fieldErrors[field.key]" :id="errorId(field.key)" class="field-error">{{ fieldErrors[field.key] }}</span>
          <div
            v-if="field.key === 'contractId' && hasNoEligibleContract"
            role="status"
            class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-12px text-danger"
          >
            <span>{{ contractEmptyMessage }}</span>
            <NuxtLink :to="meta.contractListPath" class="font-700 text-brand-deep underline">
              前往{{ meta.contractListLabel }}
            </NuxtLink>
          </div>
        </div>

        <div v-else-if="field.type === 'select'" class="field-block">
          <span class="field-label">{{ field.label }}<span v-if="field.required"> *</span></span>
          <SelectFilter
            :data-testid="`owner-document-${field.key}`"
            :model-value="String(draft[field.key] ?? '')"
            :options="field.options ?? []"
            :disabled="fieldIsReadonly(field.key)"
            full-width
            :aria-label="field.label"
            :aria-invalid="Boolean(fieldErrors[field.key]) || undefined"
            :aria-describedby="errorDescriptionId(field.key)"
            :data-field="field.key"
            @update:model-value="patch(field.key, $event)"
          />
          <span v-if="fieldErrors[field.key]" :id="errorId(field.key)" class="field-error">{{ fieldErrors[field.key] }}</span>
        </div>

        <div v-else-if="field.type === 'readonly'" class="field-block">
          <span class="field-label">{{ field.label }}</span>
          <div
            :data-testid="`owner-document-${field.key}`"
            class="field-input flex min-h-8 items-center bg-surface-2 font-mono font-700 text-ink"
          >
            {{ readonlyValue(field) }}
          </div>
          <span v-if="field.hint" class="field-hint">{{ field.hint }}</span>
        </div>

        <label
          v-else
          class="field-block"
          :class="{ 'form-span-full': field.type === 'textarea' }"
        >
          <span class="field-label">{{ field.label }}<span v-if="field.required"> *</span></span>
          <textarea
            v-if="field.type === 'textarea'"
            :data-testid="`owner-document-${field.key}`"
            :value="String(draft[field.key] ?? '')"
            rows="3"
            class="field-input w-full"
            :disabled="fieldIsReadonly(field.key)"
            :placeholder="field.placeholder"
            :aria-invalid="Boolean(fieldErrors[field.key]) || undefined"
            :aria-describedby="errorDescriptionId(field.key)"
            :data-field="field.key"
            @input="patch(field.key, inputValue($event))"
          />
          <input
            v-else
            :data-testid="`owner-document-${field.key}`"
            :value="draft[field.key] ?? ''"
            :type="field.type === 'date' ? 'date' : field.type === 'month' ? 'month' : field.type === 'number' ? 'number' : 'text'"
            :step="field.step"
            :min="field.type === 'number' ? '0' : undefined"
            class="field-input w-full"
            :class="{ 'font-mono': field.type === 'number' || field.type === 'date' || field.type === 'month' || field.key === 'no' }"
            :disabled="fieldIsReadonly(field.key)"
            :placeholder="field.placeholder"
            :aria-invalid="Boolean(fieldErrors[field.key]) || undefined"
            :aria-describedby="errorDescriptionId(field.key)"
            :data-field="field.key"
            @input="patch(field.key, field.type === 'number' ? inputNumber($event) : inputValue($event))"
          >
          <span v-if="fieldErrors[field.key]" :id="errorId(field.key)" class="field-error">{{ fieldErrors[field.key] }}</span>
          <span v-else-if="field.hint" class="field-hint">{{ field.hint }}</span>
        </label>
      </template>
    </div>
  </section>
</template>
