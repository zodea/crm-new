<script setup lang="ts">
import type { OcrRuntimeStatus } from '~/lib/ocr/settings'

defineProps<{
  status: OcrRuntimeStatus | null
  loading: boolean
  error: string
}>()

defineEmits<{
  refresh: []
}>()
</script>

<template>
  <section class="panel min-w-0 p-4" aria-labelledby="ocr-runtime-title">
    <div class="flex min-w-0 flex-wrap items-center gap-3">
      <div class="min-w-0 flex-1">
        <h2 id="ocr-runtime-title" class="m-0 text-15px font-800 text-ink">
          当前运行状态
        </h2>
        <p class="m-0 mt-1 text-11px leading-5 text-ink-faint">
          状态来自同源服务端，仅返回是否配置，不返回凭证内容。
        </p>
      </div>
      <button
        type="button"
        class="btn-secondary"
        :disabled="loading"
        aria-label="重新检测"
        @click="$emit('refresh')"
      >
        <span class="i-lucide-refresh-cw mr-1" :class="{ 'animate-spin': loading }" aria-hidden="true" />
        {{ loading ? '检测中' : '重新检测' }}
      </button>
    </div>

    <div
      v-if="error"
      role="alert"
      class="mt-3 rounded-[var(--radius-control)] border border-danger/30 bg-danger-soft px-3 py-2 text-12px text-danger-ink"
    >
      {{ error }}
    </div>

    <div v-if="status" class="mt-4 grid gap-3 sm:grid-cols-3">
      <div class="status-cell">
        <span class="status-label">配置状态</span>
        <strong :class="status.configured ? 'text-ok-ink' : 'text-warn-ink'">
          {{ status.configured ? '服务可用配置已就绪' : '未配置 Access Token' }}
        </strong>
      </div>
      <div class="status-cell">
        <span class="status-label">识别引擎</span>
        <strong>PaddleOCR 官方 API</strong>
      </div>
      <div class="status-cell">
        <span class="status-label">固定模型</span>
        <strong>{{ status.model }}</strong>
      </div>
    </div>
    <div v-else-if="loading" role="status" class="mt-4 grid gap-3 sm:grid-cols-3" aria-label="正在读取 OCR 状态">
      <span v-for="index in 3" :key="index" class="h-16 animate-pulse rounded bg-surface-2" aria-hidden="true" />
    </div>

    <div class="mt-4 flex gap-2 rounded-[var(--radius-control)] bg-surface-2 px-3 py-2 text-11px leading-5 text-ink-soft">
      <span class="i-lucide-shield-check mt-0.5 shrink-0 text-brand" aria-hidden="true" />
      <span>Token 仅在 Nitro 服务端环境变量中保存，不进入浏览器、SQLite、日志或 Git。</span>
    </div>
  </section>
</template>

<style scoped>
.status-cell {
  min-width: 0;
  padding: 0.75rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--surface-2);
}

.status-cell strong {
  display: block;
  margin-top: 0.3rem;
  overflow-wrap: anywhere;
  color: var(--ink);
  font-size: 12px;
}

.status-label {
  color: var(--ink-faint);
  font-size: 10px;
}
</style>
