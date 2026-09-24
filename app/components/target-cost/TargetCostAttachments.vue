<script setup lang="ts">
import type { BudgetFileDraft, BudgetFileDTO } from '~/lib/target-cost/central-files'

export interface PendingBudgetFile extends BudgetFileDraft { localId: string }
defineProps<{
  files: readonly BudgetFileDTO[]
  pending: readonly PendingBudgetFile[]
  removeIds: readonly string[]
  restoreIds: readonly string[]
  readonly?: boolean
  busy?: boolean
}>()
const emit = defineEmits<{
  files: [files: File[]]
  open: [id: string]
  toggle: [id: string]
  removePending: [localId: string]
  category: [localId: string, category: string]
}>()
function pick(event: Event) {
  const input = event.target as HTMLInputElement
  emit('files', [...(input.files ?? [])])
  input.value = ''
}
</script>

<template>
  <section id="section-attachments" class="panel min-w-0 scroll-mt-4 p-4" aria-label="预算附件">
    <SectionHeader title="预算附件" />
    <label v-if="!readonly" class="mt-3 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface-2 px-4 text-center hover:border-brand">
      <span class="i-lucide-upload-cloud mb-1 text-22px text-brand" aria-hidden="true" />
      <span class="text-12px font-600">点击选择附件</span>
      <span class="mt-1 text-11px text-ink-faint">原件随本次预算保存；未保存附件保留在当前草稿中。</span>
      <input type="file" multiple class="sr-only" aria-label="选择预算附件" :disabled="busy" @change="pick">
    </label>
    <p v-if="!files.length && !pending.length" class="mt-3 text-12px text-ink-faint">
      暂无预算附件
    </p>
    <div class="mt-3 grid min-w-0 gap-2">
      <div v-for="file in files" :key="file.id" class="flex min-w-0 flex-wrap items-center gap-2 rounded border border-line px-3 py-2" :class="file.deletedAt || removeIds.includes(file.id) ? 'bg-surface-2 opacity-65' : 'bg-panel'">
        <span class="i-lucide-paperclip text-ink-faint" aria-hidden="true" />
        <button v-if="file.payloadState === 'available' && !file.deletedAt" type="button" class="min-w-0 flex-1 basis-40 truncate border-0 bg-transparent p-0 text-left text-12px text-brand underline" :title="file.fileName" :disabled="busy" @click="emit('open', file.id)">
          {{ file.fileName }}
        </button>
        <span v-else class="min-w-0 flex-1 basis-40 break-words text-12px text-ink-soft">{{ file.fileName }}</span>
        <span class="text-11px text-ink-faint">{{ file.category || '未分类' }}</span>
        <span v-if="file.payloadState === 'missing'" class="text-11px text-warn-ink">原件缺失，请补传实际文件</span>
        <span v-if="file.deletedAt" class="text-11px text-danger">已删除</span>
        <button v-if="!readonly" type="button" class="border-0 bg-transparent p-0 text-12px text-brand" :disabled="busy" @click="emit('toggle', file.id)">
          {{ file.deletedAt ? restoreIds.includes(file.id) ? '取消恢复' : '恢复' : removeIds.includes(file.id) ? '撤销移除' : '移除' }}
        </button>
      </div>
      <div v-for="file in pending" :key="file.localId" class="flex min-w-0 flex-wrap items-center gap-2 rounded border border-brand/30 bg-brand-soft px-3 py-2">
        <span class="min-w-0 flex-1 basis-40 truncate text-12px" :title="file.fileName">{{ file.fileName }} · 待保存</span>
        <input :value="file.category" class="field-input h-7 w-32 text-11px" :aria-label="`${file.fileName} 附件分类`" :disabled="busy || readonly" @input="emit('category', file.localId, ($event.target as HTMLInputElement).value)">
        <button type="button" class="border-0 bg-transparent p-0 text-12px text-danger" :disabled="busy || readonly" @click="emit('removePending', file.localId)">
          移除
        </button>
      </div>
    </div>
  </section>
</template>
