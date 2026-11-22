<script setup lang="ts">
import DeliveryDuplicateReviewPanel from '~/pages/material/delivery/_components/DeliveryDuplicateReviewPanel.vue'
import DeliveryOriginalPanel from '~/pages/material/delivery/_components/DeliveryOriginalPanel.vue'
import DeliveryQueuePanel from '~/pages/material/delivery/_components/DeliveryQueuePanel.vue'
import DeliveryReviewPanel from '~/pages/material/delivery/_components/DeliveryReviewPanel.vue'
import DeliveryWorkbenchHeader from '~/pages/material/delivery/_components/DeliveryWorkbenchHeader.vue'

type WorkbenchPane = 'queue' | 'source' | 'review'

const pageRef = useTemplateRef<HTMLElement>('pageRef')
const activePane = shallowRef<WorkbenchPane>('queue')
const paneLabels: Readonly<Record<WorkbenchPane, string>> = {
  queue: '队列',
  source: '原件',
  review: '校对',
}

const {
  store,
  projects,
  suppliers,
  referenceError,
  referenceLoading,
  reloadReferences,
  aliasRetry,
  aliasSaving,
  retrySupplierAlias,
  selectedFileId,
  selectedFile,
  selectedDocument,
  previewUrl,
  reviewDraft,
  supplierSuggestion,
  amountSummary,
  reviewProgress,
  reviewIssues,
  canArchive,
  queueStatusCounts,
  queueStatuses,
  duplicates,
  duplicateSelectedId,
  duplicatePreview,
  duplicateLoading,
  saving,
  isOverDropZone,
  openFilePicker,
  selectFile,
  selectDocument,
  recognizeOne,
  recognizeAll,
  removeFile,
  classifySelected,
  openSupplierForm,
  confirmNoOrderNo,
  selectDuplicate,
  reviewDuplicate,
  patchDraft,
  patchItem,
  editItemAmount,
  addItem,
  removeItem,
  applySupplierSuggestion,
  archiveSelected,
  openPrint,
  confirmPrint,
  excludePrint,
} = useDeliveryRecognitionWorkspace(pageRef)
</script>

<template>
  <div ref="pageRef" class="relative isolate flex min-w-0 flex-col gap-3">
    <div
      v-if="isOverDropZone"
      class="pointer-events-none absolute inset-0 z-[var(--z-page-mask)] flex items-center justify-center rounded-[var(--radius-card)] border-2 border-dashed border-brand bg-brand-soft/80"
    >
      <div class="text-center text-brand-deep">
        <span class="i-lucide-file-down mx-auto mb-2 block text-32px" />
        <p class="text-14px font-800">
          松开后上传并自动识别
        </p>
      </div>
    </div>

    <DeliveryWorkbenchHeader
      :stats="store.stats"
      :pending-count="store.pendingFiles.length"
      :status-counts="queueStatusCounts"
      @upload="openFilePicker()"
      @recognize-all="recognizeAll"
    />

    <DeliveryDuplicateReviewPanel
      :duplicates="duplicates"
      :selected-id="duplicateSelectedId"
      :preview="duplicatePreview"
      :loading="duplicateLoading"
      @select="selectDuplicate"
      @confirm="reviewDuplicate"
    />

    <div v-if="referenceError" role="alert" class="panel flex flex-wrap items-center gap-3 p-3 text-13px text-danger">
      <span class="min-w-0 flex-1">{{ referenceError }}</span>
      <KitButton :loading="referenceLoading" @click="reloadReferences">
        重新读取项目与分供方
      </KitButton>
    </div>
    <div v-if="aliasRetry" role="status" class="panel flex flex-wrap items-center gap-3 p-3 text-13px text-warn-ink">
      <span class="min-w-0 flex-1">分供方别名“{{ aliasRetry.raw }}”尚未保存；送货归档与别名分别处理。</span>
      <KitButton :loading="aliasSaving" @click="retrySupplierAlias">
        重试保存别名
      </KitButton>
    </div>

    <AdaptiveWorkbench
      v-model="activePane"
      :labels="paneLabels"
      wide-columns="17rem minmax(0,38%) minmax(0,1fr)"
    >
      <template #queue>
        <DeliveryQueuePanel
          :files="store.files"
          :selected-id="selectedFileId"
          :progress="store.recognitionProgress"
          :status-by-file="queueStatuses"
          @select="selectFile"
          @upload="openFilePicker()"
          @recognize="recognizeOne"
          @remove="removeFile"
          @open-print="openPrint"
          @confirm-print="confirmPrint"
          @exclude-print="excludePrint"
        />
      </template>
      <template #source>
        <DeliveryOriginalPanel :file="selectedFile" :preview-url="previewUrl" />
      </template>
      <template #review>
        <DeliveryReviewPanel
          :draft="reviewDraft"
          :file="selectedFile"
          :document="selectedDocument"
          :documents="selectedFile?.docs ?? []"
          :projects="projects"
          :suppliers="suppliers"
          :supplier-suggestion="supplierSuggestion"
          :amount-summary="amountSummary"
          :review-progress="reviewProgress"
          :review-issues="reviewIssues"
          :can-archive="canArchive"
          :queue-status="queueStatuses[selectedFile?.id ?? ''] ?? { label: '待选择', cls: 'chip' }"
          :saving="saving"
          @select-document="selectDocument"
          @recognize="recognizeOne()"
          @patch-draft="patchDraft"
          @patch-item="patchItem"
          @edit-item-amount="editItemAmount"
          @add-item="addItem"
          @remove-item="removeItem"
          @apply-supplier-suggestion="applySupplierSuggestion"
          @open-supplier-form="openSupplierForm"
          @confirm-no-order-no="confirmNoOrderNo"
          @classify="classifySelected"
          @archive="archiveSelected"
          @open-print="openPrint"
          @confirm-print="confirmPrint"
          @exclude-print="excludePrint"
        />
      </template>
    </AdaptiveWorkbench>
  </div>
</template>
