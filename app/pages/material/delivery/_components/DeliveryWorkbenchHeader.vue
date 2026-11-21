<script setup lang="ts">
defineProps<{
  stats: {
    total: number
    pending: number
    pendingIntake: number
    processing: number
    done: number
    failed: number
    awaitingPrint: number
  }
  pendingCount: number
  statusCounts?: {
    archive: number
    review: number
    triage: number
    duplicate: number
  }
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
          PaddleOCR-VL 1.6 · 自动裁边扶正 · 表格提取 · 人工核对归档 · 打印单独回执
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
        <span class="text-10px text-ink-faint">支持 PDF、PNG、JPG、JPEG；归档后待打印原件会跨刷新保留</span>
      </span>
    </button>

    <div class="delivery-workbench-stats grid gap-3">
      <StatCard label="待人工归档" :value="statusCounts?.archive ?? stats.done" icon="i-lucide-file-check" color="ok" />
      <StatCard label="待复核" :value="statusCounts?.review ?? 0" icon="i-lucide-triangle-alert" color="warn" />
      <StatCard label="人工分流" :value="statusCounts?.triage ?? stats.pendingIntake" icon="i-lucide-file-warning" color="danger" />
      <StatCard label="重复待核查" :value="statusCounts?.duplicate ?? 0" icon="i-lucide-copy-check" color="brand" />
      <StatCard label="识别失败" :value="stats.failed" icon="i-lucide-circle-x" color="danger" />
    </div>
  </div>
</template>

<style scoped>
.delivery-workbench-stats {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
}
</style>
