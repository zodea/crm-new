<script setup lang="ts">
import type { OcrRecognitionSettings, OcrRuntimeStatus } from '~/lib/ocr/settings'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import OcrDocumentSupportTable from '~/components/ocr/OcrDocumentSupportTable.vue'
import OcrRecognitionSettingsForm from '~/components/ocr/OcrRecognitionSettingsForm.vue'
import OcrRuntimeStatusCard from '~/components/ocr/OcrRuntimeStatusCard.vue'
import {
  createDefaultOcrRecognitionSettings,
  fetchOcrRuntimeStatus,
  OCR_DOCUMENT_SUPPORT,
} from '~/lib/ocr/settings'
import { toErrorMessage } from '~/lib/util/error'
import { useOcrSettingsStore } from '~/stores/ocr-settings'

const status = shallowRef<OcrRuntimeStatus | null>(null)
const loading = shallowRef(false)
const error = shallowRef('')
const savedMessage = shallowRef('')
const store = useOcrSettingsStore()
const {
  settings,
  loading: settingsLoading,
  saving,
  error: settingsError,
} = storeToRefs(store)
const draft = ref<OcrRecognitionSettings>(createDefaultOcrRecognitionSettings())
const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(settings.value))
let latestRequest = 0

watch(dirty, (isDirty) => {
  if (isDirty)
    savedMessage.value = ''
})

async function refreshStatus() {
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

async function loadSettings() {
  try {
    await store.load()
    draft.value = { ...settings.value }
  }
  catch {
    // store.error 是页面唯一的设置加载错误源。
  }
}

function restoreDefault() {
  draft.value = createDefaultOcrRecognitionSettings()
  savedMessage.value = ''
}

async function saveSettings() {
  savedMessage.value = ''
  try {
    await store.save(draft.value)
    draft.value = { ...settings.value }
    savedMessage.value = '设置已保存，将用于后续识别任务。'
  }
  catch {
    // store.error 已包含可展示信息。
  }
}

onMounted(() => {
  void refreshStatus()
  void loadSettings()
})
</script>

<template>
  <main class="mx-auto grid w-full max-w-760px min-w-0 gap-4 pb-6" data-testid="ocr-settings-page">
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
            配置 PaddleOCR-VL 已真实接入的识别能力。设置保存在本机，识别结果仍只作预填，归属与归档必须人工确认。
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
      @refresh="refreshStatus"
    />

    <div
      v-if="settingsError"
      role="alert"
      class="rounded-[var(--radius-control)] border border-danger/30 bg-danger-soft px-3 py-2 text-12px text-danger-ink"
    >
      {{ settingsError }}
    </div>
    <div
      v-else-if="savedMessage"
      role="status"
      class="rounded-[var(--radius-control)] border border-ok/30 bg-ok-soft px-3 py-2 text-12px text-ok-ink"
    >
      {{ savedMessage }}
    </div>

    <OcrRecognitionSettingsForm
      v-model="draft"
      :dirty="dirty"
      :saving="saving"
      :loading="settingsLoading"
      @save="saveSettings"
      @restore-default="restoreDefault"
    />

    <OcrDocumentSupportTable :rows="OCR_DOCUMENT_SUPPORT" />
  </main>
</template>
