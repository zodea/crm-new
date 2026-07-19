<script setup lang="ts">
import type { DeepReadonly } from 'vue'
import type { SupplierMatch } from '~/lib/delivery/match'
import type { DeliveryDoc, DeliveryFile, DeliveryReviewInput } from '~/stores/delivery'
import type { Project } from '~/stores/project'
import type { Supplier } from '~/stores/supplier'

type DraftPatch = Partial<Omit<DeliveryReviewInput, 'items'>>

defineProps<{
  draft: DeepReadonly<DeliveryReviewInput>
  file: DeliveryFile
  document: DeliveryDoc
  projects: readonly DeepReadonly<Project>[]
  suppliers: readonly DeepReadonly<Supplier>[]
  supplierSuggestion: SupplierMatch | null
}>()

const emit = defineEmits<{
  patch: [patch: DraftPatch]
  applySupplierSuggestion: []
}>()

function valueOf(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value
}

function patchText(field: 'orderNo' | 'deliveryDate' | 'siteText' | 'note', event: Event) {
  emit('patch', { [field]: valueOf(event) })
}

function patchProject(event: Event) {
  emit('patch', { projectId: valueOf(event) })
}

function patchSupplier(event: Event) {
  emit('patch', { supplierId: valueOf(event) || null })
}

function patchDocType(event: Event) {
  emit('patch', { docType: valueOf(event) as DeliveryReviewInput['docType'] })
}
</script>

<template>
  <section class="delivery-document-fields">
    <div class="mb-2 flex items-center gap-2">
      <span class="text-11px font-800 text-ink">单据信息</span>
    </div>
    <div class="delivery-document-fields__grid grid gap-2.5">
      <div>
        <label class="field-label">所属项目 <span class="text-danger">*</span></label>
        <select :value="draft.projectId" class="field-input w-full" :class="!draft.projectId ? 'border-danger' : ''" @change="patchProject">
          <option value="" disabled>
            请选择项目
          </option>
          <option v-for="project in projects" :key="project.id" :value="project.id">
            {{ project.name }}
          </option>
        </select>
      </div>
      <div>
        <label class="field-label">分供方</label>
        <select :value="draft.supplierId ?? ''" class="field-input w-full" @change="patchSupplier">
          <option value="">
            未区分分供方
          </option>
          <option v-for="supplier in suppliers" :key="supplier.id" :value="supplier.id">
            {{ supplier.name }}
          </option>
        </select>
        <div class="mt-1 flex min-w-0 items-center gap-1 text-9px">
          <span class="shrink-0 text-ink-faint">OCR:</span>
          <span class="truncate text-ink-soft" :title="document.supplierText || file.supplierText">
            {{ document.supplierText || file.supplierText || '未识别' }}
          </span>
          <span
            v-if="supplierSuggestion"
            class="chip shrink-0 text-8px"
            :class="supplierSuggestion.kind === 'exact' ? 'chip-ok' : 'chip-warn'"
          >
            {{ supplierSuggestion.kind === 'exact' ? '精确匹配' : `建议 ${Math.round(supplierSuggestion.score * 100)}%` }}
          </span>
          <button
            v-if="supplierSuggestion?.kind === 'fuzzy' && draft.supplierId !== supplierSuggestion.id"
            type="button"
            class="shrink-0 text-8px font-700 text-brand hover:underline"
            @click="emit('applySupplierSuggestion')"
          >
            采用并记为别名
          </button>
        </div>
      </div>
      <div>
        <label class="field-label">单号</label>
        <input :value="draft.orderNo" class="field-input w-full font-mono" :class="!draft.orderNo && draft.docType !== '收据' ? 'border-warn' : ''" placeholder="未识别时可手工填写" @input="patchText('orderNo', $event)">
      </div>
      <div>
        <label class="field-label">日期</label>
        <input :value="draft.deliveryDate" type="date" class="field-input w-full font-mono" :class="!draft.deliveryDate ? 'border-warn' : ''" @input="patchText('deliveryDate', $event)">
      </div>
      <div>
        <label class="field-label">单据类型</label>
        <select :value="draft.docType" class="field-input w-full" @change="patchDocType">
          <option value="">
            未区分
          </option>
          <option value="送货单">
            送货单
          </option>
          <option value="销售单">
            销售单
          </option>
          <option value="出货单">
            出货单
          </option>
          <option value="收据">
            收据
          </option>
        </select>
      </div>
      <div>
        <label class="field-label">工地原文</label>
        <input :value="draft.siteText" class="field-input w-full" placeholder="人工选定项目后将记忆此写法" @input="patchText('siteText', $event)">
      </div>
      <div class="delivery-document-fields__full">
        <label class="field-label">复核备注</label>
        <input :value="draft.note" class="field-input w-full" placeholder="金额差异、手写内容或人工说明" @input="patchText('note', $event)">
      </div>
    </div>
  </section>
</template>

<style scoped>
.delivery-document-fields {
  container-type: inline-size;
}

.delivery-document-fields__grid {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 17.5rem), 1fr));
}

.delivery-document-fields__full {
  grid-column: 1 / -1;
}
</style>
