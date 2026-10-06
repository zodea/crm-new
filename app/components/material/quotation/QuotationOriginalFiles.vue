<script setup lang="ts">
import type { QuotationFile } from '~/lib/material-quotation/contract'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'
import { useOriginalFiles } from '~/composables/useOriginalFiles'

const props = defineProps<{
  id: string
  version: string
  files: QuotationFile[]
  canRead: boolean
}>()
const repository = useMaterialQuotationRepository()
const kit = useKitUI()
const originals = useOriginalFiles({ scope: () => `${props.id}:${props.version}:${props.canRead}`, canRead: file => props.canRead && props.files.some(row => row.id === file.id && row.deletedAt === null), read: (file, signal) => repository.original(props.id, file.id, props.version, signal), errorMessage: cause => cause instanceof Error ? cause.message : '报价原件读取失败', exportFile: kit.exportFile })
const { previewOpen, previewUrl, previewTitle, previewMime, busy, problem, canPreview, preview, download, cancel, restoreFocus } = originals
</script>

<template>
  <section class="grid min-w-0 gap-2" aria-label="报价原件">
    <StatePanel v-if="problem && !previewOpen" kind="error" title="原件读取失败" :description="problem" compact />
    <p v-if="!files.some(file => file.deletedAt === null)" class="m-0 text-13px text-ink-soft">
      此版本没有原件
    </p>
    <div v-for="file in files.filter(file => file.deletedAt === null)" :key="file.id" class="flex min-w-0 flex-wrap items-center gap-2 rounded border border-line p-3 text-13px">
      <span class="min-w-0 flex-1 break-words">{{ file.fileName }} · {{ file.fileSize }} 字节</span>
      <KitButton v-if="canPreview(file)" :disabled="Boolean(busy) || !canRead" @click="preview(file)">
        预览
      </KitButton>
      <KitButton :disabled="Boolean(busy) || !canRead" @click="download(file)">
        下载原件
      </KitButton>
    </div>
    <KitButton v-if="busy" @click="cancel">
      取消读取
    </KitButton>
    <Dialog v-model:open="previewOpen">
      <DialogContent class="flex h-[85vh] w-[calc(100vw-2rem)] max-w-1100px flex-col overflow-hidden p-4" @close-auto-focus="restoreFocus">
        <DialogTitle>{{ previewTitle }}</DialogTitle><DialogDescription>报价版本原件只读预览</DialogDescription>
        <StatePanel v-if="problem" kind="error" title="原件不可预览" :description="problem" compact />
        <StatePanel v-else-if="busy" kind="loading" title="正在读取原件" />
        <img v-else-if="previewUrl && previewMime.startsWith('image/')" :src="previewUrl" :alt="previewTitle" class="min-h-0 max-w-full flex-1 object-contain">
        <iframe v-else-if="previewUrl" :src="previewUrl" :title="previewTitle" class="min-h-0 w-full flex-1 border-0" />
      </DialogContent>
    </Dialog>
  </section>
</template>
