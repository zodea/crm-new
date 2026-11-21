<script setup lang="ts">
import type {
  FormAttachment,
  FormAttachmentDraft,
} from '~/lib/master-data/forms'
import { computed } from 'vue'
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

function inputValue(event: Event) {
  return (event.target as HTMLInputElement).value
}
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
        <button v-if="storesOriginals && !file.deletedAt" type="button" class="text-11px text-brand" :aria-label="`下载原件 ${file.fileName}`" @click="emit('download', file)">
          下载原件
        </button>
        <button
          type="button"
          :disabled="filesDisabled"
          class="text-11px"
          :class="file.deletedAt ? 'text-brand' : 'text-danger'"
          @click="emit('toggleExisting', file.id)"
        >
          {{ file.deletedAt
            ? pendingRestoreIds.includes(file.id) ? '取消恢复' : '恢复'
            : pendingRemoveIds.includes(file.id) ? '撤销删除' : '删除' }}
        </button>
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
          :disabled="filesDisabled"
          class="field-input h-7 w-32 text-11px"
          aria-label="附件分类"
          @input="emit('updatePendingCategory', file.localId, inputValue($event))"
        >
        <button type="button" class="text-11px text-danger" :disabled="filesDisabled" @click="emit('removePending', file.localId)">
          移除
        </button>
      </div>
    </div>
  </section>
</template>
