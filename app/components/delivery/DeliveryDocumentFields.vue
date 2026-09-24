<script setup lang="ts">
import type { DeepReadonly } from 'vue'
import type { ProjectMatchCandidate, SupplierMatch, SupplierMatchCandidate } from '~/lib/delivery/match'
import type { DeliveryDoc, DeliveryFile, DeliveryReviewInput } from '~/stores/delivery'

type DraftPatch = Partial<Omit<DeliveryReviewInput, 'items'>>

const props = defineProps<{
  draft: DeepReadonly<DeliveryReviewInput>
  file: DeliveryFile
  document: DeliveryDoc
  projects: readonly ProjectMatchCandidate[]
  suppliers: readonly SupplierMatchCandidate[]
  supplierSuggestion: SupplierMatch | null
}>()

const emit = defineEmits<{
  patch: [patch: DraftPatch]
  applySupplierSuggestion: []
  openSupplierForm: [initialName: string]
}>()

const supplierSearch = shallowRef('')
const supplierOpen = shallowRef(false)

const selectedSupplierName = computed(() =>
  props.suppliers.find(supplier => supplier.id === props.draft.supplierId)?.name ?? '',
)
const supplierMatches = computed(() => {
  const needle = supplierSearch.value.trim().toLocaleLowerCase('zh-CN')
  return props.suppliers.filter(supplier => !needle || [supplier.name, ...supplier.aliases ?? []]
    .some(value => value.toLocaleLowerCase('zh-CN').includes(needle)))
})
const canAddSupplier = computed(() => Boolean(
  supplierOpen.value
  && supplierSearch.value.trim()
  && !props.suppliers.some(supplier => supplier.name === supplierSearch.value.trim()),
))

function valueOf(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value
}

function patchText(field: 'orderNo' | 'deliveryDate' | 'siteText' | 'note', event: Event) {
  emit('patch', { [field]: valueOf(event) })
}

function patchProject(event: Event) {
  emit('patch', { projectId: valueOf(event) })
}

function openSupplierSearch() {
  supplierSearch.value = selectedSupplierName.value || props.document.supplierText || props.file.supplierText
  supplierOpen.value = true
}

function patchSupplierSearch(event: Event) {
  const value = valueOf(event)
  supplierSearch.value = value
  supplierOpen.value = true
  const exact = props.suppliers.find(supplier => supplier.name === value)
  emit('patch', { supplierId: exact?.id ?? null })
}

function chooseSupplier(supplier: SupplierMatchCandidate) {
  supplierSearch.value = supplier.name
  supplierOpen.value = false
  emit('patch', { supplierId: supplier.id })
}

function openCreateSupplier() {
  const value = supplierSearch.value.trim()
  if (value)
    emit('openSupplierForm', value)
}

watch(() => [props.draft.supplierId, props.document.id], () => {
  if (!supplierOpen.value)
    supplierSearch.value = selectedSupplierName.value
}, { immediate: true })

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
        <div class="relative">
          <input
            :value="supplierOpen ? supplierSearch : selectedSupplierName"
            class="field-input w-full"
            :class="!draft.supplierId ? 'border-danger' : ''"
            placeholder="搜索分供方名称"
            autocomplete="off"
            @focus="openSupplierSearch"
            @input="patchSupplierSearch"
          >
          <button
            v-if="canAddSupplier"
            type="button"
            class="delivery-supplier-create"
            aria-label="跳转新增分供方"
            title="跳转新增分供方"
            @mousedown.prevent
            @click="openCreateSupplier"
          >
            <span class="i-lucide-plus text-14px" />
          </button>
          <div v-if="supplierOpen" class="delivery-supplier-options">
            <button
              v-for="supplier in supplierMatches"
              :key="supplier.id"
              type="button"
              class="delivery-supplier-option"
              :class="supplier.id === draft.supplierId ? 'bg-brand-soft text-brand-deep' : ''"
              @mousedown.prevent
              @click="chooseSupplier(supplier)"
            >
              {{ supplier.name }}
            </button>
            <div v-if="!supplierMatches.length" class="px-2 py-1.5 text-10px text-ink-faint">
              {{ supplierSearch.trim() ? '暂无匹配，点击输入框右侧 + 新增' : '暂无分供方' }}
            </div>
          </div>
        </div>
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

.delivery-supplier-create {
  position: absolute;
  inset-block: 1px;
  right: 1px;
  width: 2rem;
  display: grid;
  place-items: center;
  border: 0;
  border-left: 1px solid var(--line);
  border-radius: 0 var(--radius-btn) var(--radius-btn) 0;
  background: transparent;
  color: var(--brand);
  cursor: pointer;
}

.delivery-supplier-create:hover {
  background: var(--brand-soft);
}

.delivery-supplier-options {
  position: absolute;
  z-index: 20;
  inset-inline: 0;
  top: calc(100% + 4px);
  max-height: 12rem;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-btn);
  background: var(--panel);
  box-shadow: var(--shadow-pop);
}

.delivery-supplier-option {
  display: block;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  font-size: 11px;
  text-align: left;
}

.delivery-supplier-option:hover {
  background: var(--surface-3);
}
</style>
