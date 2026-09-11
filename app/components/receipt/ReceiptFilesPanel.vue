<script setup lang="ts">
import type { ReceiptRecord } from '~/lib/receipt/contract'
import { computed } from 'vue'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'
import { useReceiptFiles } from '~/composables/useReceiptFiles'

const props = defineProps<{ record: ReceiptRecord }>()
const kit = useKitUI()
const { previewOpen, previewUrl, previewTitle, previewMime, busy, problem, canPreview, preview, download, cancel } = useReceiptFiles({
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
    <Dialog v-model:open="previewOpen">
      <DialogContent class="flex h-[85vh] w-[calc(100vw-2rem)] max-w-1100px flex-col gap-3 overflow-hidden p-4">
        <DialogTitle class="m-0 pr-8 text-16px font-700">
          {{ previewTitle }}
        </DialogTitle>
        <DialogDescription class="m-0 text-12px text-ink-faint">
          只读预览，可关闭后下载原文件。
        </DialogDescription>
        <StatePanel v-if="problem" kind="error" title="附件暂不可预览" :description="problem" compact />
        <StatePanel v-else-if="busy" kind="loading" title="正在读取附件" />
        <img v-else-if="previewUrl && previewMime.startsWith('image/')" :src="previewUrl" :alt="previewTitle" class="min-h-0 max-w-full flex-1 object-contain">
        <iframe v-else-if="previewUrl" :src="previewUrl" :title="previewTitle" class="min-h-0 w-full flex-1 border-0" />
      </DialogContent>
    </Dialog>
  </section>
</template>
