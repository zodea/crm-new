<script setup lang="ts">
import type { ContractDetailFile } from '~/lib/contract/detail'

defineProps<{
  files: readonly ContractDetailFile[]
}>()

const { preview, download } = useFileRefAccess()

function fileSize(bytes: number): string {
  if (!bytes)
    return '大小未记录'
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <section class="panel p-4" aria-labelledby="contract-files-title">
    <SectionHeader
      id="contract-files-title"
      title="合同文件"
    />
    <ul v-if="files.length" class="mt-3 grid gap-2" aria-label="合同文件列表">
      <li
        v-for="file in files"
        :key="file.id"
        class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border border-line bg-surface-1 px-3 py-2.5"
      >
        <span class="i-lucide-paperclip h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate text-13px font-700 text-ink" :title="file.fileName">
          {{ file.fileName || '未命名文件' }}
        </span>
        <span class="text-11px text-ink-soft">{{ file.category || '合同附件' }}</span>
        <span class="font-mono text-11px text-ink-faint">{{ fileSize(file.fileSize) }}</span>
        <span class="text-11px text-ink-faint">{{ file.uploadedAt || '上传时间未记录' }}</span>
        <span class="ml-auto flex items-center gap-2">
          <button
            type="button"
            class="text-11px text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand"
            @click="preview(file)"
          >
            预览
          </button>
          <button
            type="button"
            class="text-11px text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand"
            @click="download(file)"
          >
            下载
          </button>
        </span>
      </li>
    </ul>
    <StatePanel
      v-else
      class="mt-3"
      kind="empty"
      title="暂无合同文件"
      description="当前合同尚未关联有效附件。"
      compact
    />
  </section>
</template>
