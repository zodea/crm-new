<script setup lang="ts">
import type { OwnerCommercialDocumentDetailReadDTO } from '~/lib/owner-document/central-repository'

defineProps<{
  label: string
  files: OwnerCommercialDocumentDetailReadDTO['files']
}>()

function fileSize(bytes: number): string {
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <section class="panel p-4" aria-labelledby="acceptance-files-title">
    <SectionHeader id="acceptance-files-title" :title="`${label}附件`" subtitle="只展示当前视图所属附件" />
    <ul v-if="files.length" class="mt-3 grid gap-2" :aria-label="`${label}附件列表`">
      <li v-for="file in files" :key="file.id" class="flex min-w-0 flex-wrap items-center gap-3 border border-line bg-surface-1 px-3 py-2.5">
        <span class="i-lucide-paperclip h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
        <strong class="min-w-0 flex-1 truncate text-13px">{{ file.fileName }}</strong>
        <span class="text-11px text-ink-soft">{{ file.category }}</span>
        <span class="font-mono text-11px text-ink-faint">{{ fileSize(file.fileSize) }}</span>
      </li>
    </ul>
    <StatePanel v-else class="mt-3" kind="empty" title="暂无附件" :description="`当前${label}视图没有有效附件引用。`" compact />
  </section>
</template>
