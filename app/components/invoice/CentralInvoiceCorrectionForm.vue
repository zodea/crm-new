<script setup lang="ts">
import type { CentralInvoiceFields, CentralInvoiceItem, CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import type { InvoiceMigrationCatalog } from '~/lib/invoice/central-migration-catalog'
import type { InvoiceCorrectionContent, InvoiceCorrectionDraft } from '~/lib/invoice/correction-contract'
import { computed, shallowRef } from 'vue'
import { invoiceCorrectionChanges } from '~/lib/invoice/correction-contract'
import CentralInvoiceFieldsForm from './CentralInvoiceFieldsForm.vue'

const props = defineProps<{ invoice: CentralInvoiceRecord, baseline: InvoiceCorrectionContent, proposed: InvoiceCorrectionContent, reason: string, catalog: InvoiceMigrationCatalog, signatories: Array<{ id: string, label: string, version: string }>, draft: InvoiceCorrectionDraft | null, busy: boolean, editable: boolean }>()
const emit = defineEmits<{ proposed: [value: InvoiceCorrectionContent], reason: [value: string], dirty: [value: boolean], addFiles: [files: File[]], removeFile: [id: string] }>()
const formKey = shallowRef(0)
const fieldRecord = computed(() => ({ ...props.invoice, fields: props.proposed.fields, items: props.proposed.items }))
const changes = computed(() => invoiceCorrectionChanges(props.baseline, props.proposed))
const contracts = computed(() => props.catalog.contracts.filter((contract) => {
  if (props.proposed.ownerKind === 'company' ? contract.domain !== 'company' : contract.domain === 'company')
    return false
  return (!contract.projectId || contract.projectId === props.proposed.projectId) && (!contract.supplierId || contract.supplierId === props.proposed.supplierId)
}))
const selectedContract = computed(() => props.proposed.contract ? JSON.stringify([props.proposed.contract.domain, props.proposed.contract.id, props.proposed.contract.version]) : '')
const selectedSupplier = computed(() => props.catalog.suppliers.some(item => item.id === props.proposed.supplierId && item.version === props.proposed.supplierVersion) ? props.proposed.supplierId : '')
const selectedBuyer = computed(() => props.signatories.some(item => item.id === props.proposed.buyer?.id && item.version === props.proposed.buyer?.version) ? props.proposed.buyer?.id : '')
const labels: Record<string, string> = { 'ownerKind': '归属', 'projectId': '项目', 'supplierId': '分供方', 'buyer': '我方主体', 'contract': '合同', 'items': '货物明细', 'fields.invoiceNumber': '发票号码', 'fields.invoiceDate': '开票日期', 'fields.invoiceType': '发票类型', 'fields.buyer': '购买方', 'fields.buyerTaxNo': '购买方税号', 'fields.seller': '销售方', 'fields.sellerTaxNo': '销售方税号', 'fields.amount': '不含税金额', 'fields.taxAmount': '税额', 'fields.totalAmount': '价税合计', 'fields.taxRate': '税率', 'fields.remark': '备注' }
function update(patch: Partial<InvoiceCorrectionContent>) {
  emit('proposed', { ...props.proposed, ...patch })
}
function setOwner(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'project' || value === 'company' || (value === 'personal' && props.baseline.ownerKind === 'personal'))
    update({ ownerKind: value, projectId: value === 'project' ? props.proposed.projectId : null, contract: null })
}
function setProject(event: Event) {
  update({ projectId: (event.target as HTMLSelectElement).value || null, contract: null })
}
function setSupplier(event: Event) {
  const selected = props.catalog.suppliers.find(item => item.id === (event.target as HTMLSelectElement).value)
  update({ supplierId: selected?.id ?? null, supplierVersion: selected?.version ?? null, contract: null })
}
function setBuyer(event: Event) {
  const selected = props.signatories.find(item => item.id === (event.target as HTMLSelectElement).value)
  update({ buyer: selected ? { id: selected.id, version: selected.version } : null })
}
function setContract(event: Event) {
  const selected = contracts.value.find(item => JSON.stringify([item.domain, item.id, item.version]) === (event.target as HTMLSelectElement).value)
  update({ contract: selected ? { domain: selected.domain, id: selected.id, version: selected.version } : null })
}
function applyFields(payload: { fields: CentralInvoiceFields, items: CentralInvoiceItem[] }) {
  update({ fields: payload.fields, items: payload.items })
  formKey.value++
  emit('dirty', false)
}
function show(value: unknown, path: string) {
  if (value === null || value === '')
    return '未填写'
  if (path === 'ownerKind')
    return ({ project: '项目', company: '公司开销', personal: '历史个人开支' } as Record<string, string>)[String(value)] ?? String(value)
  if (path === 'projectId' || path === 'supplierId') {
    const options = path === 'projectId' ? props.catalog.projects : props.catalog.suppliers
    return options.find(item => item.id === value)?.label ?? `${String(value)}（资料来源待核对）`
  }
  if (path === 'buyer' && typeof value === 'object' && value && 'id' in value) {
    const buyer = value as { id: string, version: string }
    return `${props.signatories.find(item => item.id === buyer.id)?.label ?? buyer.id}（版本 ${buyer.version}）`
  }
  if (path === 'contract' && typeof value === 'object' && value && 'domain' in value && 'id' in value) {
    const contract = value as { domain: string, id: string, version: string }
    return `${props.catalog.contracts.find(item => item.id === contract.id && item.domain === contract.domain)?.label ?? contract.id}（版本 ${contract.version}）`
  }
  if (typeof value === 'object')
    return JSON.stringify(value)
  return String(value)
}
</script>

<template>
  <div class="grid min-w-0 gap-4 lg:grid-cols-2">
    <CentralInvoiceFieldsForm :key="formKey" :record="fieldRecord" :busy="busy || !editable" correction-mode lock-actions @save="applyFields" @dirty="emit('dirty', $event)" />
    <section class="min-w-0 space-y-4 border border-line rounded bg-panel p-4" aria-label="更正归属和依据">
      <h2 class="font-700">
        更正归属和依据
      </h2>
      <p class="text-sm text-ink-soft">
        原票身份和历史保留；提交后才生效。请逐项核对票面、主体和合同。
      </p>
      <label class="flex flex-col gap-1 text-sm">归属
        <select aria-label="更正归属" :value="proposed.ownerKind" :disabled="busy || !editable" class="border border-line rounded p-2" @change="setOwner">
          <option v-if="baseline.ownerKind === 'personal'" value="personal">历史个人开支</option>
          <option value="project">项目</option><option value="company">公司开销</option>
        </select>
      </label>
      <label v-if="proposed.ownerKind === 'project'" class="flex flex-col gap-1 text-sm">项目
        <select :value="proposed.projectId ?? ''" :disabled="busy || !editable" class="border border-line rounded p-2" @change="setProject">
          <option value="">请选择项目</option><option v-for="item in catalog.projects" :key="item.id" :value="item.id">{{ item.label }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-sm">分供方
        <select aria-label="更正分供方" :value="selectedSupplier" :disabled="busy || !editable" class="border border-line rounded p-2" @change="setSupplier">
          <option value="">请选择已有分供方</option><option v-for="item in catalog.suppliers" :key="item.id" :value="item.id">{{ item.label }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-sm">我方主体
        <select aria-label="更正我方主体" :value="selectedBuyer" :disabled="busy || !editable" class="border border-line rounded p-2" @change="setBuyer">
          <option value="">请选择我方主体</option><option v-for="item in signatories" :key="item.id" :value="item.id">{{ item.label }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-sm">合同（公司开销必选）
        <select aria-label="更正关联合同" :value="selectedContract" :disabled="busy || !editable" class="border border-line rounded p-2" @change="setContract">
          <option value="">不关联合同</option><option v-for="item in contracts" :key="`${item.domain}:${item.id}`" :value="JSON.stringify([item.domain, item.id, item.version])">{{ item.label }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-sm">更正原因
        <textarea :value="reason" :disabled="busy || !editable" maxlength="2000" class="min-h-20 border border-line rounded p-2" @input="emit('reason', ($event.target as HTMLTextAreaElement).value)" />
      </label>
      <label v-if="editable" class="flex flex-col gap-1 text-sm">更正附件（可选）
        <input type="file" multiple :disabled="busy" @change="emit('addFiles', Array.from(($event.target as HTMLInputElement).files ?? [])); ($event.target as HTMLInputElement).value = ''">
      </label>
      <ul v-if="draft?.attachments.length" class="space-y-1 text-sm">
        <li v-for="file in draft.attachments" :key="file.id" class="flex flex-wrap items-center gap-2">
          <a :href="`/api/read/invoice-corrections/${encodeURIComponent(draft.id)}/files/${encodeURIComponent(file.id)}`" class="text-brand underline">{{ file.fileName }}</a>
          <button v-if="editable" type="button" :disabled="busy" class="text-danger" @click="emit('removeFile', file.id)">
            从草稿移除
          </button>
        </li>
      </ul>
      <div aria-label="更正前后差异" class="space-y-2">
        <h3 class="font-600">
          更正前后差异
        </h3>
        <p v-if="!changes.length" class="text-sm text-ink-soft">
          尚无变更。
        </p>
        <ul v-else class="space-y-2 text-sm">
          <li v-for="change in changes" :key="change.path" class="break-words">
            {{ labels[change.path] ?? change.path }}：{{ show(change.before, change.path) }} → {{ show(change.after, change.path) }}
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
