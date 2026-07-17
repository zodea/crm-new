<script setup lang="ts">
import type { DeepReadonly } from 'vue'
import type { DeliveryFile, DeliveryOcrStatus } from '~/stores/delivery'
import { formatFileSize } from '~/lib/util/file'

defineProps<{
  files: readonly DeepReadonly<DeliveryFile>[]
  selectedId: string | null
  progress: Readonly<Record<string, number>>
}>()

const emit = defineEmits<{
  select: [id: string]
  upload: []
  recognize: [id: string]
  remove: [id: string]
}>()

const STATUS: Record<DeliveryOcrStatus, { label: string, cls: string }> = {
  pending: { label: '待识别', cls: 'chip-warn' },
  processing: { label: '识别中', cls: 'chip-brand' },
  done: { label: '待核对', cls: 'chip-ok' },
  failed: { label: '识别失败', cls: 'chip-danger' },
}

function itemCount(file: DeepReadonly<DeliveryFile>): number {
  return file.docs.reduce((sum, doc) => sum + doc.items.length, 0)
}
</script>

<template>
  <aside class="h-full min-h-0 w-68 shrink-0 overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel shadow-[var(--shadow-card)]">
    <div class="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2.5">
      <div>
        <div class="text-12px font-800 text-ink">
          处理队列
        </div>
        <div class="text-10px text-ink-faint">
          {{ files.length }} 个文件
        </div>
      </div>
      <div class="flex-1" />
      <button type="button" class="btn-secondary px-[11px] py-[5px] text-12px" @click="emit('upload')">
        <span class="i-lucide-plus mr-1" />上传
      </button>
    </div>

    <div class="h-[calc(100%-54px)] overflow-y-auto p-2">
      <div
        v-for="file in files"
        :key="file.id"
        class="mb-2 w-full rounded-[var(--radius-btn)] border p-2.5 text-left transition-colors last:mb-0"
        :class="selectedId === file.id ? 'border-brand bg-brand-soft/45' : 'border-line bg-panel hover:bg-surface-2'"
        role="button"
        tabindex="0"
        @click="emit('select', file.id)"
        @keydown.enter="emit('select', file.id)"
        @keydown.space.prevent="emit('select', file.id)"
      >
        <div class="flex items-start gap-2">
          <span :class="file.kind === 'pdf' ? 'i-lucide-file-text' : 'i-lucide-image'" class="mt-0.5 shrink-0 text-15px text-brand" />
          <div class="min-w-0 flex-1">
            <div class="truncate text-12px font-700 text-ink" :title="file.name">
              {{ file.name }}
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-1.5">
              <span class="chip text-9px" :class="STATUS[file.ocrStatus].cls">
                {{ file.ocrStatus === 'processing' ? `识别中 ${progress[file.id] ?? 0}%` : STATUS[file.ocrStatus].label }}
              </span>
              <span class="text-9px text-ink-faint">{{ formatFileSize(file.size) }}</span>
            </div>
            <div v-if="file.ocrStatus === 'done'" class="mt-1.5 text-10px text-ink-soft">
              <div class="truncate" :title="file.supplierText">
                {{ file.supplierText || '未识别分供方' }}
              </div>
              <div>{{ file.docs.length }} 张单 · {{ itemCount(file) }} 条明细</div>
            </div>
            <div v-else-if="file.ocrError" class="mt-1.5 line-clamp-2 text-10px text-danger" :title="file.ocrError">
              {{ file.ocrError }}
            </div>
          </div>
        </div>

        <div class="mt-2 flex items-center justify-end gap-1 border-t border-line/70 pt-1.5">
          <button
            v-if="file.ocrStatus === 'pending' || file.ocrStatus === 'failed'"
            type="button"
            class="icon-btn h-7 w-7"
            title="识别"
            @click.stop="emit('recognize', file.id)"
          >
            <span class="i-lucide-scan-text text-12px" />
          </button>
          <button
            type="button"
            class="icon-btn-danger h-7 w-7"
            title="移出队列"
            :disabled="file.ocrStatus === 'processing'"
            @click.stop="emit('remove', file.id)"
          >
            <span class="i-lucide-trash-2 text-12px" />
          </button>
        </div>
      </div>

      <button
        v-if="!files.length"
        type="button"
        class="w-full rounded-[var(--radius-card)] border border-dashed border-line px-4 py-10 text-center text-11px text-ink-faint hover:border-brand hover:text-brand"
        @click="emit('upload')"
      >
        <span class="i-lucide-files mb-2 block text-22px" />
        上传 PDF 或图片开始识别
      </button>
    </div>
  </aside>
</template>
