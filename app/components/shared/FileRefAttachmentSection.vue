<script setup lang="ts">
import type {
  FileRefDraft,
  FileRefRecord,
} from '~/lib/forms/file-refs'
import AttachmentDraftRow from '~/components/shared/AttachmentDraftRow.vue'
import AttachmentExistingRow from '~/components/shared/AttachmentExistingRow.vue'
import AttachmentPicker from '~/components/shared/AttachmentPicker.vue'
import KitButton from '~/components/ui/KitButton.vue'

export interface PendingFileRef extends FileRefDraft {
  localId: string
}

defineProps<{
  attachments: ReadonlyArray<Readonly<FileRefRecord>>
  pendingAttachments: ReadonlyArray<Readonly<PendingFileRef>>
  pendingRemoveIds: readonly string[]
  pendingRestoreIds: readonly string[]
  title?: string
  note: string
  noteReadonly?: boolean
  categoryReadonly?: boolean
  readonly?: boolean
  pickerDescription?: string
  canDownload?: boolean
}>()

const emit = defineEmits<{
  files: [files: File[]]
  toggleExisting: [id: string]
  removePending: [localId: string]
  patchPending: [localId: string, patch: Partial<PendingFileRef>]
  updateNote: [value: string]
  download: [id: string, trigger: HTMLElement]
}>()

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}
</script>

<template>
  <section id="section-attachments" class="panel scroll-mt-4 p-4">
    <SectionHeader :title="title ?? '附件与备注'" />

    <AttachmentPicker
      v-if="!readonly"
      class="mt-3"
      :description="pickerDescription ?? '浏览器保存文件元数据'"
      input-test-id="finance-attachment-input"
      @files="emit('files', $event)"
    />

    <div v-if="attachments.length || pendingAttachments.length" class="mt-3 grid gap-2">
      <AttachmentExistingRow
        v-for="file in attachments"
        :key="file.id"
        :file-name="file.fileName"
        :category="file.category"
        :deleted="Boolean(file.deletedAt)"
        :pending-remove="pendingRemoveIds.includes(file.id)"
        :pending-restore="pendingRestoreIds.includes(file.id)"
        :readonly="readonly"
      >
        <template #download>
          <KitButton
            v-if="canDownload && !file.deletedAt && !pendingRemoveIds.includes(file.id)"
            type="button"
            variant="ghost"
            class="h-7 shrink-0 px-2 text-11px"
            :aria-label="`下载原件 ${file.fileName}`"
            @click="emit('download', file.id, $event.currentTarget as HTMLElement)"
          >
            下载原件
          </KitButton>
        </template>
        <template #toggle="{ label, tone }">
          <KitButton variant="ghost" class="h-7 shrink-0 px-2 text-11px" :class="tone" @click="emit('toggleExisting', file.id)">
            {{ label }}
          </KitButton>
        </template>
      </AttachmentExistingRow>

      <AttachmentDraftRow
        v-for="file in pendingAttachments"
        :key="file.localId"
        :file-name="file.fileName"
        :category="file.category"
        :readonly="readonly"
        :category-readonly="categoryReadonly"
        @update-category="emit('patchPending', file.localId, { category: $event })"
      >
        <template #remove>
          <KitButton variant="ghost" class="h-7 shrink-0 px-2 text-11px text-danger" @click="emit('removePending', file.localId)">
            移除
          </KitButton>
        </template>
      </AttachmentDraftRow>
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
