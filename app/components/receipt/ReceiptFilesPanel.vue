<script setup lang="ts">
import type { ReceiptRecord } from '~/lib/receipt/contract'
import { computed } from 'vue'
import OriginalFilePreviewDialog from '~/components/shared/OriginalFilePreviewDialog.vue'
import { useReceiptFiles } from '~/composables/useReceiptFiles'

const props = defineProps<{ record: ReceiptRecord }>()
const kit = useKitUI()
const { previewOpen, previewUrl, previewTitle, previewMime, busy, problem, canPreview, preview, download, cancel, restoreFocus } = useReceiptFiles({
  record: () => props.record,
  repository: useNuxtApp().$repositories.receipts,
  exportFile: kit.exportFile,
})
const files = computed(() => props.record.attachments.filter(file => file.deletedAt === null))
</script>

<template>
  <section class="panel min-w-0 p-4" aria-label="收款凭证附件">
    <SectionHeader title="凭证附件" />
    <p v-if="!files.length" class="mb-0 text-12px text-ink-faint">
      未登记附件。
    </p>
    <StatePanel v-if="problem && !previewOpen" kind="error" title="附件读取失败" :description="problem" compact />
    <ul class="m-0 mt-3 grid list-none gap-2 p-0">
      <li v-for="file in files" :key="file.id" class="flex min-w-0 flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-line px-3 py-2">
        <span class="min-w-0 flex-1 break-words text-12px">{{ file.fileName }}</span>
        <span class="text-11px text-ink-faint">{{ file.category || '未分类' }} · {{ file.fileSize.toLocaleString() }} 字节</span>
        <KitButton v-if="canPreview(file)" :disabled="Boolean(busy) || record.dataOrigin !== 'real'" @click="preview(file)">
          预览
        </KitButton>
        <KitButton :disabled="Boolean(busy) || record.dataOrigin !== 'real'" @click="download(file)">
          下载
        </KitButton>
      </li>
    </ul>
    <KitButton v-if="busy" class="mt-3" @click="cancel">
      取消附件读取
    </KitButton>
    <OriginalFilePreviewDialog
      v-model:open="previewOpen"
      :title="previewTitle"
      :url="previewUrl"
      :mime="previewMime"
      :busy="Boolean(busy)"
      :problem="problem"
      @close-auto-focus="restoreFocus"
    />
  </section>
</template>
