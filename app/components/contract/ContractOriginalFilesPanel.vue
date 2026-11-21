<script setup lang="ts">
import type { ContractOriginalContent } from '~/lib/forms/original-content'
import type { DataOriginDTO } from '~/types/read-model'
import OriginalFilePreviewDialog from '~/components/shared/OriginalFilePreviewDialog.vue'
import { useOriginalFiles } from '~/composables/useOriginalFiles'

interface OriginalFile { id: string, fileName: string, fileSize: number, mimeType: string, category: string, uploadedAt: string | null }
const props = defineProps<{
  ownerId: string
  origin: DataOriginDTO
  sourceVersion: string | null
  canRead: boolean
  files: OriginalFile[]
  readContent: (ownerId: string, fileId: string, origin: DataOriginDTO, options?: { signal?: AbortSignal }) => Promise<ContractOriginalContent>
}>()
const kit = useKitUI()
function readable(file: OriginalFile) {
  return props.origin === 'real' && props.canRead && props.files.some(row => row.id === file.id)
}
const { previewOpen, previewUrl, previewTitle, previewMime, busy, problem, canPreview, preview, download, cancel, restoreFocus } = useOriginalFiles({
  scope: () => `${props.origin}:${props.ownerId}:${props.sourceVersion}:${props.canRead}:${props.files.map(file => file.id).join(',')}`,
  canRead: readable,
  read: (file, signal) => props.readContent(props.ownerId, file.id, props.origin, { signal }),
  errorMessage: cause => cause instanceof Error ? cause.message : '附件读取失败，请重新读取',
  exportFile: kit.exportFile,
})
</script>

<template>
  <section class="min-w-0" aria-label="合同原件附件">
    <SectionHeader class="mt-5" title="合同文件" />
    <StatePanel v-if="problem && !previewOpen" class="mt-2" kind="error" title="附件读取失败" :description="problem" compact />
    <ul v-if="files.length" class="m-0 mt-2 grid list-none gap-2 p-0">
      <li v-for="file in files" :key="file.id" class="flex min-w-0 flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-line p-3 text-12px">
        <span class="min-w-0 flex-1 break-words">{{ file.fileName }}</span>
        <span class="text-ink-soft">{{ file.category || '未分类' }} · {{ file.fileSize.toLocaleString() }} 字节</span>
        <KitButton v-if="canPreview(file)" :disabled="Boolean(busy) || !readable(file)" @click="preview(file)">
          预览
        </KitButton>
        <KitButton :disabled="Boolean(busy) || !readable(file)" @click="download(file)">
          下载
        </KitButton>
      </li>
    </ul>
    <StatePanel v-else class="mt-2" kind="empty" title="暂无合同文件" compact />
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
