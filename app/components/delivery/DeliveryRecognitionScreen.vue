<script setup lang="ts">
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
  projectStore,
  supplierStore,
  selectedFileId,
  selectedFile,
  selectedDocument,
  previewUrl,
  reviewDraft,
  supplierSuggestion,
  amountSummary,
  reviewProgress,
  saving,
  isOverDropZone,
  openFilePicker,
  selectFile,
  selectDocument,
  recognizeOne,
  recognizeAll,
  removeFile,
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
  <div ref="pageRef" class="relative flex min-w-0 flex-col gap-3">
    <div
      v-if="isOverDropZone"
      class="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-[var(--radius-card)] border-2 border-dashed border-brand bg-brand-soft/80"
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
      @upload="openFilePicker()"
      @recognize-all="recognizeAll"
    />

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
          :projects="projectStore.list"
          :suppliers="supplierStore.list"
          :supplier-suggestion="supplierSuggestion"
          :amount-summary="amountSummary"
          :review-progress="reviewProgress"
          :saving="saving"
          @select-document="selectDocument"
          @recognize="recognizeOne()"
          @patch-draft="patchDraft"
          @patch-item="patchItem"
          @edit-item-amount="editItemAmount"
          @add-item="addItem"
          @remove-item="removeItem"
          @apply-supplier-suggestion="applySupplierSuggestion"
          @archive="archiveSelected"
          @open-print="openPrint"
          @confirm-print="confirmPrint"
          @exclude-print="excludePrint"
        />
      </template>
    </AdaptiveWorkbench>
  </div>
</template>
