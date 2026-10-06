<script setup lang="ts">
import type { ContractOriginalContent } from '~/lib/forms/original-content'
import type { DataOriginDTO } from '~/types/read-model'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'
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
    <Dialog v-model:open="previewOpen">
      <DialogContent class="flex h-[85vh] w-[calc(100vw-2rem)] max-w-1100px flex-col gap-3 overflow-hidden p-4" @close-auto-focus="restoreFocus">
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
