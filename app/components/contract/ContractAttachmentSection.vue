<script setup lang="ts">
import type {
  ContractFormAttachment,
  ContractFormAttachmentDraft,
} from '~/lib/contract/forms'
import AttachmentDraftRow from '~/components/shared/AttachmentDraftRow.vue'
import AttachmentExistingRow from '~/components/shared/AttachmentExistingRow.vue'
import AttachmentPicker from '~/components/shared/AttachmentPicker.vue'

interface PendingContractAttachment extends ContractFormAttachmentDraft {
  localId: string
}

defineProps<{
  attachments: ReadonlyArray<Readonly<ContractFormAttachment>>
  pendingAttachments: ReadonlyArray<Readonly<PendingContractAttachment>>
  pendingRemoveIds: readonly string[]
  pendingRestoreIds: readonly string[]
  note: string
  filesDisabled?: boolean
}>()

const emit = defineEmits<{
  files: [files: File[]]
  toggleExisting: [id: string]
  removePending: [localId: string]
  patchPending: [localId: string, patch: Partial<PendingContractAttachment>]
  updateNote: [value: string]
}>()

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}
</script>

<template>
  <section id="section-attachments" class="panel scroll-mt-4 p-4">
    <SectionHeader title="附件与备注" />

    <AttachmentPicker
      class="mt-3"
      description="附件正文读取完成后随本次保存提交；历史缺正文附件须重新上传"
      :disabled="filesDisabled"
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
        :disabled="filesDisabled"
        @toggle="emit('toggleExisting', file.id)"
      />

      <AttachmentDraftRow
        v-for="file in pendingAttachments"
        :key="file.localId"
        :file-name="file.fileName"
        :category="file.category"
        :disabled="filesDisabled"
        @update-category="emit('patchPending', file.localId, { category: $event })"
        @remove="emit('removePending', file.localId)"
      />
    </div>

    <label class="mt-4 block">
      <span class="field-label">备注</span>
      <textarea
        :value="note"
        rows="4"
        class="field-input w-full"
        placeholder="补充说明"
        @input="emit('updateNote', inputValue($event))"
      />
    </label>
  </section>
</template>
