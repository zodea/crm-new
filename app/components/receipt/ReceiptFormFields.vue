<script setup lang="ts">
import type { LookupOption } from '~/lib/kit/lookup'
import type { ReceiptContext, ReceiptDraft } from '~/lib/receipt/contract'
import KitButton from '~/components/ui/KitButton.vue'
import LookupSelect from '~/components/ui/LookupSelect.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'

const props = defineProps<{
  draft: ReceiptDraft
  context: ReceiptContext
  fieldErrors: Record<string, string[]>
  readonly?: boolean
}>()
const emit = defineEmits<{ patch: [value: Partial<ReceiptDraft>] }>()
const basicFields = [
  ['no', '收款单号', 'text'],
  ['receiptDate', '收款日期', 'date'],
  ['payerAccount', '付款方账号', 'text'],
] as const
const paymentFields = [
  ['paymentMethod', '收款方式', 'text'],
  ['acceptanceBillNo', '承兑汇票号', 'text'],
  ['billDueDate', '汇票到期日', 'date'],
  ['periodNo', '收款期次', 'text'],
  ['bankSerialNo', '银行流水号', 'text'],
  ['handler', '经办人', 'text'],
  ['reviewStatus', '审核状态', 'text'],
] as const
function input(event: Event) {
  return (event.target as HTMLInputElement).value
}
function lookup(rows: LookupOption[], keyword: string) {
  const search = keyword.trim().toLocaleLowerCase('zh-CN')
  return Promise.resolve(rows.filter(row => !search || `${row.label} ${row.hint ?? ''}`.toLocaleLowerCase('zh-CN').includes(search)))
}
const projects = (keyword: string) => lookup(props.context.projects.map(row => ({ id: row.id, label: row.name })), keyword)
const customers = (keyword: string) => lookup(props.context.customers.filter(row => !props.draft.projectId || props.context.projects.find(project => project.id === props.draft.projectId)?.customerId === row.id).map(row => ({ id: row.id, label: row.name })), keyword)
const contracts = (keyword: string) => lookup(props.context.contracts.filter(row => row.projectId === props.draft.projectId).map(row => ({ id: row.id, label: row.name || row.no, hint: row.no })), keyword)
function projectChanged(projectId: string | null) {
  emit('patch', { projectId, contractId: null, customerId: props.context.projects.find(row => row.id === projectId)?.customerId ?? null })
}
</script>

<template>
  <fieldset class="m-0 grid min-w-0 gap-4 border-0 p-0" :disabled="readonly">
    <section id="section-basic" class="panel scroll-mt-4 p-4">
      <SectionHeader title="基本信息" />
      <div class="form-fields-grid mt-3">
        <label v-for="[key, label, type] in basicFields" :key="key" class="field-block">
          <span class="field-label">{{ label }}{{ key === 'receiptDate' ? ' *' : '' }}</span>
          <input :aria-label="label" :value="draft[key]" :type="type" class="field-input w-full" :aria-invalid="Boolean(fieldErrors[key])" @input="emit('patch', { [key]: input($event) })">
          <span v-if="fieldErrors[key]" class="field-error">{{ fieldErrors[key]?.[0] }}</span>
        </label>
        <div class="field-block">
          <label id="receipt-project-label" class="field-label">项目 *</label>
          <LookupSelect :model-value="draft.projectId" :fetch="projects" field="projectId" :invalid="Boolean(fieldErrors.projectId)" :description-id="fieldErrors.projectId ? 'receipt-projectId-error' : undefined" aria-labelledby="receipt-project-label" :disabled-reason="readonly ? '当前不可编辑' : undefined" placeholder="选择项目" @update:model-value="projectChanged" />
          <span v-if="fieldErrors.projectId" id="receipt-projectId-error" class="field-error">{{ fieldErrors.projectId[0] }}</span>
        </div>
        <div class="field-block">
          <label id="receipt-customer-label" class="field-label">付款方客户 *</label>
          <LookupSelect :key="draft.projectId ?? 'no-project'" :model-value="draft.customerId" :fetch="customers" field="customerId" :invalid="Boolean(fieldErrors.customerId)" :description-id="fieldErrors.customerId ? 'receipt-customerId-error' : undefined" aria-labelledby="receipt-customer-label" :disabled-reason="readonly ? '当前不可编辑' : undefined" placeholder="选择项目主客户" @update:model-value="emit('patch', { customerId: $event })" />
          <span v-if="fieldErrors.customerId" id="receipt-customerId-error" class="field-error">{{ fieldErrors.customerId[0] }}</span>
        </div>
        <div class="field-block">
          <label id="receipt-contract-label" class="field-label">施工合同</label>
          <LookupSelect :key="draft.projectId ?? 'no-project'" :model-value="draft.contractId" :fetch="contracts" field="contractId" :invalid="Boolean(fieldErrors.contractId)" :description-id="fieldErrors.contractId ? 'receipt-contractId-error' : undefined" aria-labelledby="receipt-contract-label" :disabled-reason="readonly ? '当前不可编辑' : !draft.projectId ? '请先选择项目' : undefined" placeholder="可不关联施工合同" @update:model-value="emit('patch', { contractId: $event })" />
          <KitButton v-if="draft.contractId && !readonly" type="button" variant="ghost" class="w-fit" @click="emit('patch', { contractId: null })">
            清除合同
          </KitButton>
          <span v-if="fieldErrors.contractId" id="receipt-contractId-error" class="field-error">{{ fieldErrors.contractId[0] }}</span>
        </div>
      </div>
    </section>
    <section id="section-amount" class="panel scroll-mt-4 p-4">
      <SectionHeader title="金额与方式" />
      <div class="form-fields-grid mt-3">
        <label class="field-block">
          <span class="field-label">收款金额 *</span>
          <input :value="draft.amount ?? ''" type="text" inputmode="decimal" aria-label="收款金额" :aria-invalid="Boolean(fieldErrors.amount)" class="field-input w-full font-mono" placeholder="未填写" @input="emit('patch', { amount: input($event) === '' ? null : input($event) })">
          <span v-if="fieldErrors.amount" class="field-error">{{ fieldErrors.amount[0] }}</span>
        </label>
        <label v-for="[key, label, type] in paymentFields" :key="key" class="field-block">
          <span class="field-label">{{ label }}</span>
          <input :aria-label="label" :value="draft[key]" :type="type" class="field-input w-full" :aria-invalid="Boolean(fieldErrors[key])" @input="emit('patch', { [key]: input($event) })">
          <span v-if="fieldErrors[key]" class="field-error">{{ fieldErrors[key]?.[0] }}</span>
        </label>
      </div>
    </section>
  </fieldset>
</template>
