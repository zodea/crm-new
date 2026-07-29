<script setup lang="ts">
import type { OcrRuntimeStatus } from '~/lib/ocr/settings'
import { onMounted, shallowRef } from 'vue'
import { fetchOcrRuntimeStatus, OCR_DOCUMENT_SUPPORT } from '~/lib/ocr/settings'
import { toErrorMessage } from '~/lib/util/error'

const status = shallowRef<OcrRuntimeStatus | null>(null)
const loading = shallowRef(false)
const error = shallowRef('')
let latestRequest = 0

async function refresh() {
  const request = ++latestRequest
  loading.value = true
  error.value = ''
  try {
    const next = await fetchOcrRuntimeStatus()
    if (request === latestRequest)
      status.value = next
  }
  catch (cause) {
    if (request === latestRequest) {
      status.value = null
      error.value = toErrorMessage(cause)
    }
  }
  finally {
    if (request === latestRequest)
      loading.value = false
  }
}

onMounted(refresh)
</script>

<template>
  <main class="mx-auto grid w-full max-w-1280px min-w-0 gap-4 pb-6" data-testid="ocr-settings-page">
    <header class="panel min-w-0 overflow-hidden p-4">
      <div class="flex min-w-0 items-start gap-3">
        <span class="i-lucide-scan-search mt-0.5 shrink-0 text-24px text-brand" aria-hidden="true" />
        <div class="min-w-0">
          <p class="m-0 text-11px font-700 text-brand">
            设置 / OCR
          </p>
          <h1 class="m-0 mt-1 text-20px font-800 text-ink">
            OCR 设置
          </h1>
          <p class="m-0 mt-1 max-w-720px text-12px leading-5 text-ink-soft">
            查看当前真实引擎、单据接入和安全边界。识别结果只作预填，人工核对、归属与归档规则不由置信度代替。
          </p>
        </div>
      </div>
    </header>

    <div class="rounded-[var(--radius-card)] border border-warn/30 bg-warn-soft px-4 py-3 text-12px leading-5 text-warn-ink">
      <strong>联网与隐私提醒：</strong>
      当前已实现模式会把待识别文件经本机 Nitro 代理上传到 PaddleOCR 官方服务。请只在明确接受联网处理时配置并使用。
    </div>

    <OcrRuntimeStatusCard
      :status="status"
      :loading="loading"
      :error="error"
      @refresh="refresh"
    />

    <OcrDocumentSupportTable :rows="OCR_DOCUMENT_SUPPORT" />
    <OcrParameterBoundary />
  </main>
</template>
