<script setup lang="ts">
import type { DeliveryOcrStatus } from '~/stores/delivery'

defineProps<{
  stats: Record<DeliveryOcrStatus | 'total', number>
  pendingCount: number
}>()

const emit = defineEmits<{
  upload: []
  recognizeAll: []
}>()
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="panel flex flex-wrap items-center gap-3 px-4 py-3">
      <div class="min-w-0 flex-[1_1_22rem]">
        <div class="text-16px font-800 text-ink">
          送货单识别工作台
        </div>
        <div class="mt-0.5 text-11px text-ink-faint">
          PaddleOCR-VL 1.6 · 自动裁边扶正 · 表格提取 · 人工核对后自动归档
        </div>
      </div>
      <button type="button" class="btn-secondary" :disabled="!pendingCount" @click="emit('recognizeAll')">
        <span class="i-lucide-scan-text mr-1 text-12px" />识别全部（{{ pendingCount }}）
      </button>
      <button type="button" class="btn-primary" @click="emit('upload')">
        <span class="i-lucide-upload mr-1 text-12px" />上传送货单
      </button>
    </div>

    <button
      type="button"
      class="flex items-center justify-center gap-3 rounded-[var(--radius-card)] border border-dashed border-brand/55 bg-brand-soft/25 px-4 py-3 text-left transition-colors hover:bg-brand-soft/55"
      @click="emit('upload')"
    >
      <span class="i-lucide-folder-up text-20px text-brand" />
      <span>
        <b class="block text-12px text-ink">拖拽或点击上传 PDF / 图片</b>
        <span class="text-10px text-ink-faint">支持 PDF、PNG、JPG、JPEG；文件仅在当前识别会话保留</span>
      </span>
    </button>

    <div class="delivery-workbench-stats grid gap-3">
      <StatCard label="队列文件" :value="stats.total" icon="i-lucide-files" color="brand" />
      <StatCard label="待识别" :value="stats.pending + stats.processing" icon="i-lucide-clock" color="warn" />
      <StatCard label="待核对" :value="stats.done" icon="i-lucide-file-check" color="ok" />
      <StatCard label="识别失败" :value="stats.failed" icon="i-lucide-circle-x" color="danger" />
    </div>
  </div>
</template>

<style scoped>
.delivery-workbench-stats {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
}
</style>
