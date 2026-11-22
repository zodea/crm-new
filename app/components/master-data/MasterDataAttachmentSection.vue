<script setup lang="ts">
import type {
  FormAttachment,
  FormAttachmentDraft,
} from '~/lib/master-data/forms'
import { computed } from 'vue'
import AttachmentDraftRow from '~/components/shared/AttachmentDraftRow.vue'
import AttachmentExistingRow from '~/components/shared/AttachmentExistingRow.vue'
import AttachmentPicker from '~/components/shared/AttachmentPicker.vue'

export interface PendingMasterDataAttachment extends FormAttachmentDraft {
  localId: string
}

const props = defineProps<{
  title: string
  storesOriginals?: boolean
  originalDescription?: string
  attachments: FormAttachment[]
  pendingAttachments: PendingMasterDataAttachment[]
  pendingRemoveIds: string[]
  pendingRestoreIds: string[]
  filesDisabled?: boolean
}>()

const emit = defineEmits<{
  files: [files: File[]]
  download: [file: FormAttachment]
  toggleExisting: [id: string]
  removePending: [localId: string]
  updatePendingCategory: [localId: string, category: string]
}>()

const pickerDescription = computed(() => props.storesOriginals
  ? props.originalDescription || '原件随客户一同保存，重启后可下载；最多 9 份，单份不超过 10 MiB'
  : '浏览器预览仅保存元数据；桌面应用会保存可重新打开的本机路径')
</script>

<template>
  <section id="section-attachments" class="panel scroll-mt-4 p-4">
    <SectionHeader :title="title" />

    <AttachmentPicker
      :description="pickerDescription"
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
      >
        <template #download>
          <button v-if="storesOriginals && !file.deletedAt" type="button" class="text-11px text-brand" :aria-label="`下载原件 ${file.fileName}`" @click="emit('download', file)">
            下载原件
          </button>
        </template>
      </AttachmentExistingRow>
      <AttachmentDraftRow
        v-for="file in pendingAttachments"
        :key="file.localId"
        :file-name="file.fileName"
        :category="file.category"
        :disabled="filesDisabled"
        compact-category
        @update-category="emit('updatePendingCategory', file.localId, $event)"
        @remove="emit('removePending', file.localId)"
      />
    </div>
  </section>
</template>
