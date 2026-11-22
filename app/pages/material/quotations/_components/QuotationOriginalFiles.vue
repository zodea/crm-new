<script setup lang="ts">
import type { QuotationFile } from '~/lib/material-quotation/contract'
import OriginalFilePreviewDialog from '~/components/shared/OriginalFilePreviewDialog.vue'
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
    <OriginalFilePreviewDialog
      v-model:open="previewOpen"
      :title="previewTitle"
      :url="previewUrl"
      :mime="previewMime"
      :busy="Boolean(busy)"
      :problem="problem"
      description="报价版本原件只读预览"
      error-title="原件不可预览"
      loading-title="正在读取原件"
      compact
      @close-auto-focus="restoreFocus"
    />
  </section>
</template>
