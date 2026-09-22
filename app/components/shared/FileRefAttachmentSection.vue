<script setup lang="ts">
import type {
  FileRefDraft,
  FileRefRecord,
} from '~/lib/forms/file-refs'
import KitButton from '~/components/ui/KitButton.vue'

export interface PendingFileRef extends FileRefDraft {
  localId: string
}

defineProps<{
  attachments: ReadonlyArray<Readonly<FileRefRecord>>
  pendingAttachments: ReadonlyArray<Readonly<PendingFileRef>>
  pendingRemoveIds: readonly string[]
  pendingRestoreIds: readonly string[]
  desktopPicker: boolean
  title?: string
  note: string
  noteReadonly?: boolean
  categoryReadonly?: boolean
  readonly?: boolean
  pickerDescription?: string
}>()

const emit = defineEmits<{
  pickNative: []
  files: [files: File[]]
  toggleExisting: [id: string]
  removePending: [localId: string]
  patchPending: [localId: string, patch: Partial<PendingFileRef>]
  updateNote: [value: string]
}>()

function handleFiles(event: Event) {
  const input = event.target as HTMLInputElement
  emit('files', [...(input.files ?? [])])
  input.value = ''
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}
</script>

<template>
  <section id="section-attachments" class="panel scroll-mt-4 p-4">
    <SectionHeader :title="title ?? '附件与备注'" />
    <button
      v-if="!readonly && desktopPicker"
      type="button"
      class="mt-3 flex min-h-24 w-full cursor-pointer flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface-2 px-4 text-center transition-colors hover:border-brand hover:bg-brand-soft"
      data-testid="finance-attachment-picker"
      @click="emit('pickNative')"
    >
      <span class="i-lucide-upload-cloud mb-1 text-22px text-brand" aria-hidden="true" />
      <span class="text-12px font-600 text-ink">点击选择附件</span>
      <span class="mt-0.5 text-11px text-ink-faint">桌面端保存可重新打开的本机路径</span>
    </button>
    <label
      v-else-if="!readonly"
      class="mt-3 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface-2 px-4 text-center transition-colors hover:border-brand hover:bg-brand-soft"
    >
      <span class="i-lucide-upload-cloud mb-1 text-22px text-brand" aria-hidden="true" />
      <span class="text-12px font-600 text-ink">点击选择附件</span>
      <span class="mt-0.5 text-11px text-ink-faint">{{ pickerDescription ?? '浏览器保存文件元数据；桌面应用保存真实路径' }}</span>
      <input
        type="file"
        multiple
        class="sr-only"
        data-testid="finance-attachment-input"
        @change="handleFiles"
      >
    </label>

    <div v-if="attachments.length || pendingAttachments.length" class="mt-3 grid gap-2">
      <div
        v-for="file in attachments"
        :key="file.id"
        class="flex items-center gap-2 rounded-[var(--radius-control)] border border-line px-3 py-2"
        :class="pendingRemoveIds.includes(file.id)
          ? 'bg-danger-soft opacity-65'
          : pendingRestoreIds.includes(file.id)
            ? 'border-brand/30 bg-brand-soft'
            : file.deletedAt ? 'bg-surface-2 opacity-65' : 'bg-panel'"
      >
        <span class="i-lucide-paperclip text-ink-faint" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate text-12px text-ink">{{ file.fileName }}</span>
        <span class="text-10px text-ink-faint">{{ file.category || '未分类' }}</span>
        <span v-if="file.deletedAt" class="text-10px text-danger">已删除</span>
        <KitButton
          v-if="!readonly"
          variant="ghost"
          class="h-7 shrink-0 px-2 text-11px"
          :class="file.deletedAt ? 'text-brand' : 'text-danger'"
          @click="emit('toggleExisting', file.id)"
        >
          {{ file.deletedAt
            ? pendingRestoreIds.includes(file.id) ? '取消恢复' : '恢复'
            : pendingRemoveIds.includes(file.id) ? '撤销删除' : '删除' }}
        </KitButton>
      </div>

      <div
        v-for="file in pendingAttachments"
        :key="file.localId"
        class="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-brand/30 bg-brand-soft px-3 py-2"
      >
        <span class="i-lucide-file-plus-2 text-brand" aria-hidden="true" />
        <span class="min-w-36 flex-1 truncate text-12px text-ink">{{ file.fileName }}</span>
        <input
          :value="file.category"
          :disabled="readonly"
          :readonly="categoryReadonly"
          class="field-input h-7 w-36 text-11px"
          aria-label="附件分类"
          @input="emit('patchPending', file.localId, { category: inputValue($event) })"
        >
        <KitButton
          v-if="!readonly"
          variant="ghost"
          class="h-7 shrink-0 px-2 text-11px text-danger"
          @click="emit('removePending', file.localId)"
        >
          移除
        </KitButton>
      </div>
    </div>

    <label class="mt-4 block">
      <span class="field-label">备注</span>
      <textarea
        :value="note"
        rows="4"
        :disabled="readonly || noteReadonly"
        class="field-input w-full"
        placeholder="补充说明"
        @input="emit('updateNote', inputValue($event))"
      />
    </label>
  </section>
</template>
