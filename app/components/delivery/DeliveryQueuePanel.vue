<script setup lang="ts">
import type { DeepReadonly } from 'vue'
import type { DeliveryFile, DeliveryOcrStatus } from '~/stores/delivery'
import { formatFileSize } from '~/lib/util/file'

defineProps<{
  files: readonly DeepReadonly<DeliveryFile>[]
  selectedId: string | null
  progress: Readonly<Record<string, number>>
  statusByFile?: Readonly<Record<string, { label: string, cls: string }>>
}>()

const emit = defineEmits<{
  select: [id: string]
  upload: []
  recognize: [id: string]
  remove: [id: string]
  openPrint: [id: string]
  confirmPrint: [id: string]
  excludePrint: [id: string]
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

function statusOf(file: DeepReadonly<DeliveryFile>, statusByFile: Readonly<Record<string, { label: string, cls: string }>> = {}): { label: string, cls: string } {
  if (statusByFile[file.id])
    return statusByFile[file.id]!
  if (file.printDisposition === 'pending')
    return { label: '已入库 · 待打印', cls: 'chip-warn' }
  return STATUS[file.ocrStatus]
}
</script>

<template>
  <aside class="panel h-full min-h-0 w-full flex flex-col overflow-hidden">
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

    <div class="flex flex-wrap items-center gap-1.5 border-b border-line bg-panel px-3 py-2 text-9px text-ink-faint">
      <span class="chip-ok">待人工归档</span>
      <span class="chip-warn">待复核</span>
      <span class="chip-danger">人工分流</span>
      <span class="ml-1">文件名后的颜色表示当前处理状态</span>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-2">
      <div
        v-for="file in files"
        :key="file.id"
        class="mb-2 w-full rounded-[var(--radius-btn)] border p-2.5 text-left transition-colors last:mb-0"
        :class="selectedId === file.id ? 'border-brand bg-brand-soft/45' : 'border-line bg-panel hover:bg-surface-2'"
        role="button"
        :aria-pressed="selectedId === file.id"
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
              <span class="chip text-9px" :class="statusOf(file, statusByFile).cls">
                {{ file.ocrStatus === 'processing' ? `识别中 ${progress[file.id] ?? 0}%` : statusOf(file, statusByFile).label }}
              </span>
              <span class="text-9px text-ink-faint">{{ formatFileSize(file.size) }}</span>
            </div>
            <div v-if="file.printDisposition === 'pending'" class="mt-1.5 text-10px text-ink-soft">
              已归档并进入材料台账；打印成功或明确排除前保留在此。
            </div>
            <div v-else-if="file.ocrStatus === 'done'" class="mt-1.5 text-10px text-ink-soft">
              <div class="truncate" :title="file.supplierText">
                {{ file.supplierText || '未识别分供方' }}
              </div>
              <div>{{ file.docs.length }} 张单 · {{ itemCount(file) }} 条明细</div>
            </div>
          </div>
        </div>

        <div class="mt-2 flex flex-wrap items-center justify-end gap-1 border-t border-line/70 pt-1.5">
          <button
            v-if="file.printDisposition === 'pending'"
            type="button"
            class="btn-secondary px-2 py-1 text-10px"
            title="只打开送货单原件和系统打印窗口，不改变打印状态"
            @click.stop="emit('openPrint', file.id)"
          >
            <span class="i-lucide-printer mr-1 text-11px" />打开打印
          </button>
          <button
            v-if="file.printDisposition === 'pending'"
            type="button"
            class="btn-primary px-2 py-1 text-10px"
            title="打印机实际输出后，登记打印回执并移出待打印范围"
            @click.stop="emit('confirmPrint', file.id)"
          >
            登记已打印
          </button>
          <button
            v-if="file.printDisposition === 'pending'"
            type="button"
            class="btn-secondary px-2 py-1 text-10px"
            title="不打印本文件并移出待打印范围"
            @click.stop="emit('excludePrint', file.id)"
          >
            排除打印
          </button>
          <button
            v-if="file.printDisposition == null && (file.ocrStatus === 'pending' || file.ocrStatus === 'failed')"
            type="button"
            class="icon-btn h-7 w-7"
            title="识别"
            @click.stop="emit('recognize', file.id)"
          >
            <span class="i-lucide-scan-text text-12px" />
          </button>
          <button
            v-if="file.printDisposition == null"
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
