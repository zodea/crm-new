<script setup lang="ts">
import type { DeepReadonly } from 'vue'
import type { SupplierMatch } from '~/lib/delivery/match'
import type { DeliveryAmountSummary } from '~/lib/delivery/review'
import type { DeliveryDoc, DeliveryFile, DeliveryItem, DeliveryReviewInput } from '~/stores/delivery'
import type { Project } from '~/stores/project'
import type { Supplier } from '~/stores/supplier'

type DraftPatch = Partial<Omit<DeliveryReviewInput, 'items'>>
type ItemTextPatch = Partial<Pick<DeliveryItem, 'name' | 'spec' | 'unit' | 'note'>>

const props = defineProps<{
  draft: DeepReadonly<DeliveryReviewInput> | null
  file?: DeliveryFile
  document?: DeliveryDoc
  documents: readonly DeliveryDoc[]
  projects: readonly DeepReadonly<Project>[]
  suppliers: readonly DeepReadonly<Supplier>[]
  supplierSuggestion: SupplierMatch | null
  amountSummary: DeliveryAmountSummary
  reviewProgress: { passed: number, total: number }
  saving: boolean
}>()

const emit = defineEmits<{
  selectDocument: [id: string]
  archive: []
  recognize: []
  patchDraft: [patch: DraftPatch]
  patchItem: [index: number, patch: ItemTextPatch]
  editItemAmount: [index: number, field: 'qty' | 'unitPrice' | 'amount', value: number]
  addItem: []
  removeItem: [index: number]
  applySupplierSuggestion: []
}>()

const amountStatus = computed(() => {
  if (props.amountSummary.mismatchedLineIds.length)
    return { label: `${props.amountSummary.mismatchedLineIds.length} 行金额不平`, className: 'chip-danger' }
  if (props.amountSummary.statedBalanced === false)
    return { label: '票面合计不平', className: 'chip-danger' }
  if (props.amountSummary.statedBalanced === true)
    return { label: '金额已勾稽', className: 'chip-ok' }
  return { label: '明细已核算', className: 'chip' }
})

function relayItemPatch(index: number, patch: ItemTextPatch) {
  emit('patchItem', index, patch)
}

function relayAmountEdit(index: number, field: 'qty' | 'unitPrice' | 'amount', value: number) {
  emit('editItemAmount', index, field, value)
}
</script>

<template>
  <section class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel shadow-[var(--shadow-card)]">
    <div class="flex min-h-11 shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
      <div>
        <div class="text-11px font-800 text-ink">
          识别结果校对
        </div>
        <div class="text-9px text-ink-faint">
          核对完成后自动进入归档库
        </div>
      </div>
      <span v-if="file && document" class="chip text-9px">
        已核对 {{ reviewProgress.passed }}/{{ reviewProgress.total }}
      </span>
      <div class="flex-1" />
      <NuxtLink to="/material/delivery/archive" class="btn-secondary px-2.5 py-1.5 text-10px">
        <span class="i-lucide-archive mr-1" />归档库
      </NuxtLink>
    </div>

    <template v-if="file && document && draft">
      <div v-if="documents.length > 1" class="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 py-2">
        <button
          v-for="(doc, index) in documents"
          :key="doc.id"
          type="button"
          class="shrink-0 rounded-[var(--radius-btn)] px-2.5 py-1 text-10px font-600"
          :class="doc.id === document.id ? 'bg-brand text-white' : 'bg-surface-3 text-ink-soft hover:bg-brand-soft'"
          @click="emit('selectDocument', doc.id)"
        >
          第 {{ index + 1 }} 张{{ doc.orderNo ? ` · ${doc.orderNo}` : '' }}
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        <div class="mb-3 flex items-center gap-2">
          <span class="chip text-9px" :class="amountStatus.className">{{ amountStatus.label }}</span>
          <span v-if="file.preprocessed" class="chip-ok text-9px">已自动裁边扶正</span>
          <span v-if="reviewProgress.passed < reviewProgress.total" class="text-9px text-ink-faint">
            黄/红项需确认后再归档
          </span>
        </div>

        <div v-if="document.note" class="mb-3 flex gap-2 rounded-[var(--radius-btn)] border border-warn/40 bg-warn-soft px-3 py-2 text-10px text-warn-ink">
          <span class="i-lucide-triangle-alert mt-0.5 shrink-0" />
          <span>{{ document.note }}</span>
        </div>

        <DeliveryDocumentFields
          :draft="draft"
          :file="file"
          :document="document"
          :projects="projects"
          :suppliers="suppliers"
          :supplier-suggestion="supplierSuggestion"
          @patch="emit('patchDraft', $event)"
          @apply-supplier-suggestion="emit('applySupplierSuggestion')"
        />

        <DeliveryItemsEditor
          :items="draft.items"
          :summary="amountSummary"
          @add="emit('addItem')"
          @remove="emit('removeItem', $event)"
          @patch="relayItemPatch"
          @edit-amount="relayAmountEdit"
        />
      </div>

      <div class="flex shrink-0 items-center gap-2 border-t border-line bg-surface-2 px-3 py-2.5">
        <button type="button" class="btn-secondary" :disabled="saving" @click="emit('recognize')">
          <span class="i-lucide-refresh-cw mr-1 text-12px" />重新识别
        </button>
        <div class="flex-1" />
        <span class="text-9px text-ink-faint">项目必选；提醒项会在归档前再次确认</span>
        <button type="button" class="btn-primary" :disabled="saving" @click="emit('archive')">
          <span :class="saving ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-circle-check'" class="mr-1 text-12px" />
          {{ saving ? '归档中…' : '核对完成并归档' }}
        </button>
      </div>
    </template>

    <div v-else-if="file?.ocrStatus === 'processing'" class="flex flex-1 flex-col items-center justify-center text-11px text-brand">
      <span class="i-lucide-loader-circle mb-2 animate-spin text-24px" />
      PaddleOCR-VL 正在识别版面与表格…
    </div>
    <div v-else-if="file?.ocrStatus === 'failed'" class="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <span class="i-lucide-circle-alert mb-2 text-24px text-danger" />
      <p class="text-11px text-danger">
        {{ file.ocrError }}
      </p>
      <button type="button" class="btn-secondary mt-3" @click="emit('recognize')">
        重新识别
      </button>
    </div>
    <div v-else-if="file" class="flex flex-1 flex-col items-center justify-center text-11px text-ink-faint">
      <span class="i-lucide-scan-text mb-2 text-24px" />
      等待识别
      <button type="button" class="btn-primary mt-3" @click="emit('recognize')">
        开始识别
      </button>
    </div>
    <div v-else class="flex flex-1 flex-col items-center justify-center text-11px text-ink-faint">
      <span class="i-lucide-mouse-pointer-click mb-2 text-24px" />
      从左侧队列选择一个文件
    </div>
  </section>
</template>
