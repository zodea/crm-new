<script setup lang="ts">
import type { DeepReadonly } from 'vue'
import type { SupplierMatch } from '~/lib/delivery/match'
import type { DeliveryAmountSummary, DeliveryReviewIssue } from '~/lib/delivery/review'
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
  reviewIssues: readonly DeliveryReviewIssue[]
  canArchive: boolean
  queueStatus: { label: string, cls: string }
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
  openSupplierForm: [initialName: string]
  confirmNoOrderNo: []
  classify: [decision: 'material' | 'non-material']
  openPrint: [id: string]
  confirmPrint: [id: string]
  excludePrint: [id: string]
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

const issueKeys = computed(() => new Set(props.reviewIssues.map(issue => issue.key)))

function hasIssue(key: string): boolean {
  return issueKeys.value.has(key as DeliveryReviewIssue['key'])
}

function relayItemPatch(index: number, patch: ItemTextPatch) {
  emit('patchItem', index, patch)
}

function relayAmountEdit(index: number, field: 'qty' | 'unitPrice' | 'amount', value: number) {
  emit('editItemAmount', index, field, value)
}
</script>

<template>
  <section class="delivery-review-panel panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
    <div class="flex min-h-11 shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
      <div>
        <div class="text-11px font-800 text-ink">
          人工复核与归档
        </div>
        <div class="text-9px text-ink-faint">
          OCR 只生成草稿；查看原件后再人工归档
        </div>
      </div>
      <span v-if="file" class="text-9px" :class="queueStatus.cls">
        {{ queueStatus.label }}
      </span>
      <div class="flex-1" />
      <NuxtLink to="/material/delivery/archive" class="btn-secondary px-[11px] py-[5px] text-12px">
        <span class="i-lucide-archive mr-1" />归档库
      </NuxtLink>
    </div>

    <template v-if="file && file.intakeDecision !== 'material' && file.printDisposition !== 'pending'">
      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        <div class="rounded-[var(--radius-card)] border border-danger/45 bg-danger-soft px-3 py-3 text-11px text-danger-ink">
          <div class="flex items-center gap-2 font-800">
            <span class="i-lucide-file-warning" />疑似非材料文件，暂不进入 OCR
          </div>
          <p class="mt-2 leading-5">
            {{ file.intakeReason || '请先人工判断它是否属于材料送货单。' }}。确认后只影响当前文件，其他文件继续按原队列处理。
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" class="btn-primary" @click="emit('classify', 'material')">
              <span class="i-lucide-scan-text mr-1" />按材料送货单处理
            </button>
            <button type="button" class="btn-secondary" @click="emit('classify', 'non-material')">
              保留为非材料
            </button>
          </div>
        </div>
      </div>
    </template>

    <template v-else-if="file && document && draft">
      <div v-if="documents.length > 1" class="flex flex-wrap shrink-0 gap-1 border-b border-line px-3 py-2">
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

        <div
          class="mb-3 rounded-[var(--radius-card)] border px-3 py-2.5 text-10px"
          :class="reviewIssues.length ? 'border-warn/55 bg-warn-soft text-warn-ink' : 'border-ok/55 bg-ok-soft text-ok-ink'"
        >
          <div class="flex items-center gap-2 font-800">
            <span :class="reviewIssues.length ? 'i-lucide-triangle-alert' : 'i-lucide-circle-check'" />
            {{ reviewIssues.length ? `发现 ${reviewIssues.length} 个需要处理的问题` : '未发现待处理问题，可直接人工归档' }}
          </div>
          <div v-if="reviewIssues.length" class="mt-1.5 grid gap-1 leading-4">
            <div v-for="issue in reviewIssues" :key="`${issue.key}-${issue.label}`">
              · {{ issue.label }}
            </div>
          </div>
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
          @open-supplier-form="emit('openSupplierForm', $event)"
        />

        <div v-if="hasIssue('order-no')" class="mt-2 flex flex-wrap items-center gap-2 text-10px text-danger-ink">
          <span>如果原件确实没有单号：</span>
          <button type="button" class="btn-secondary px-2 py-1 text-10px" @click="emit('confirmNoOrderNo')">
            <span class="i-lucide-file-check mr-1" />确认原件无单号
          </button>
        </div>

        <DeliveryItemsEditor
          :items="draft.items"
          :summary="amountSummary"
          @add="emit('addItem')"
          @remove="emit('removeItem', $event)"
          @patch="relayItemPatch"
          @edit-amount="relayAmountEdit"
        />
      </div>

      <div class="delivery-review-panel__footer flex flex-wrap shrink-0 items-center gap-2 border-t border-line bg-surface-2 px-3 py-2.5">
        <button type="button" class="btn-secondary" :disabled="saving" @click="emit('recognize')">
          <span class="i-lucide-refresh-cw mr-1 text-12px" />重新识别
        </button>
        <div class="flex-1" />
        <span class="delivery-review-panel__hint text-9px text-ink-faint">
          {{ canArchive ? '问题已处理，点击归档时会再次确认已查看原件' : '请先处理右侧标记的问题' }}
        </span>
        <button type="button" class="btn-accent" :disabled="saving || !canArchive" @click="emit('archive')">
          <span :class="saving ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-circle-check'" class="mr-1 text-12px" />
          {{ saving ? '归档中…' : '确认人工归档' }}
        </button>
      </div>
    </template>

    <div v-else-if="file?.printDisposition === 'pending'" class="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <span class="i-lucide-printer mb-2 text-26px text-brand" />
      <p class="text-13px font-800 text-ink">
        已归档并入库，等待打印
      </p>
      <p class="mt-1 max-w-96 text-10px leading-5 text-ink-faint">
        “打开打印”只打开原件，不改变状态；打印机实际输出后再单独登记。取消或打印失败时不用操作，文件会继续保留。
      </p>
      <div class="mt-4 flex flex-wrap justify-center gap-2">
        <button type="button" class="btn-secondary" @click="emit('openPrint', file.id)">
          <span class="i-lucide-printer mr-1" />打开打印
        </button>
        <button type="button" class="btn-accent" @click="emit('confirmPrint', file.id)">
          登记已打印
        </button>
        <button type="button" class="btn-secondary" @click="emit('excludePrint', file.id)">
          排除打印
        </button>
      </div>
    </div>
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
      <button type="button" class="btn-accent mt-3" @click="emit('recognize')">
        开始识别
      </button>
    </div>
    <div v-else class="flex flex-1 flex-col items-center justify-center text-11px text-ink-faint">
      <span class="i-lucide-mouse-pointer-click mb-2 text-24px" />
      从左侧队列选择一个文件
    </div>
  </section>
</template>

<style scoped>
.delivery-review-panel {
  container-type: inline-size;
}

@container (max-width: 33.999rem) {
  .delivery-review-panel__hint {
    order: 3;
    width: 100%;
  }
}
</style>
