<script setup lang="ts">
import type { OcrRecognitionSettings } from '~/lib/ocr/settings'
import { computed } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'
import { OCR_TIMEOUT_LIMITS } from '~/lib/ocr/settings'

interface Props {
  dirty: boolean
  saving: boolean
  loading?: boolean
}

withDefaults(defineProps<Props>(), {
  loading: false,
})

const emit = defineEmits<{
  save: []
  restoreDefault: []
}>()

const model = defineModel<OcrRecognitionSettings>({ required: true })

type TimeoutKey = 'requestTimeoutMs' | 'pollTimeoutMs'

const timeoutLabels: Record<TimeoutKey, string> = {
  requestTimeoutMs: '单次请求超时',
  pollTimeoutMs: '任务轮询总超时',
}

function timeoutError(key: TimeoutKey): string {
  const value = model.value[key]
  const limits = OCR_TIMEOUT_LIMITS[key]
  if (!Number.isFinite(value))
    return `请输入${timeoutLabels[key]}`
  if (!Number.isInteger(value) || value < limits.min || value > limits.max) {
    return `${timeoutLabels[key]}须在 ${limits.min / 1000}–${limits.max / 1000} 秒之间`
  }
  return ''
}

const timeoutErrors = computed(() => ({
  requestTimeoutMs: timeoutError('requestTimeoutMs'),
  pollTimeoutMs: timeoutError('pollTimeoutMs'),
}))
const hasValidationErrors = computed(() =>
  Boolean(timeoutErrors.value.requestTimeoutMs || timeoutErrors.value.pollTimeoutMs),
)

const capabilityRows: {
  key: keyof Pick<
    OcrRecognitionSettings,
    | 'useDocOrientationClassify'
    | 'useDocUnwarping'
    | 'useLayoutDetection'
    | 'useChartRecognition'
    | 'useSealRecognition'
    | 'useOcrForImageBlock'
    | 'formatBlockContent'
  >
  label: string
  hint: string
}[] = [
  { key: 'useDocOrientationClassify', label: '文档方向识别', hint: '自动识别 0°、90°、180°、270° 页面方向' },
  { key: 'useDocUnwarping', label: '文档矫正', hint: '矫正拍照造成的弯曲、透视和倾斜' },
  { key: 'useLayoutDetection', label: '版面分析', hint: '识别标题、表格、正文和图片等版面区域' },
  { key: 'useChartRecognition', label: '图表识别', hint: '识别柱状图、折线图等图表内容；普通单据可关闭' },
  { key: 'useSealRecognition', label: '印章识别', hint: '保留印章区域的文字识别结果' },
  { key: 'useOcrForImageBlock', label: '图片块 OCR', hint: '对版面中的图片区域继续执行文字识别' },
  { key: 'formatBlockContent', label: '格式化区块内容', hint: '按版面语义格式化识别后的区块内容' },
]

function updateBoolean(key: (typeof capabilityRows)[number]['key'], checked: boolean) {
  model.value = { ...model.value, [key]: checked }
}

function updateTimeout(key: TimeoutKey, rawSeconds: string) {
  const seconds = rawSeconds.trim() === '' ? Number.NaN : Number(rawSeconds)
  model.value = {
    ...model.value,
    [key]: Number.isFinite(seconds) ? Math.round(seconds * 1000) : Number.NaN,
  }
}
</script>

<template>
  <section
    class="panel min-w-0 overflow-hidden"
    aria-labelledby="ocr-recognition-settings-title"
    data-testid="ocr-recognition-settings-form"
  >
    <header class="flex min-w-0 flex-wrap items-start gap-3 border-b border-line px-4 py-3.5">
      <div class="min-w-0 flex-1">
        <h2 id="ocr-recognition-settings-title" class="m-0 text-15px font-800 text-ink">
          识别参数
        </h2>
        <p class="m-0 mt-1 text-11px leading-5 text-ink-faint">
          设置保存在本机 SQLite，并随每次识别请求发送；不会保存 Token、API 地址或模型名。
        </p>
      </div>
      <span
        class="status-chip shrink-0"
        :class="dirty ? 'bg-warn-soft text-warn-ink' : 'bg-ok-soft text-ok-ink'"
      >
        {{ dirty ? '有未保存修改' : '已保存' }}
      </span>
    </header>

    <div v-if="loading" role="status" aria-label="正在读取 OCR 设置" class="grid gap-2 p-4">
      <span v-for="index in 5" :key="index" class="h-14 animate-pulse rounded bg-surface-2" aria-hidden="true" />
    </div>

    <div v-else class="divide-y divide-line">
      <fieldset class="m-0 min-w-0 border-0 p-0">
        <legend class="w-full bg-surface-2 px-4 py-2 text-11px font-700 text-ink-soft">
          推理能力
        </legend>
        <label
          v-for="row in capabilityRows"
          :key="row.key"
          class="setting-row"
        >
          <span class="min-w-0 flex-1">
            <strong class="block text-12px text-ink">{{ row.label }}</strong>
            <span class="mt-0.5 block text-11px leading-4 text-ink-faint">{{ row.hint }}</span>
          </span>
          <span class="switch-control">
            <input
              type="checkbox"
              class="peer absolute inset-0 z-1 h-full w-full cursor-pointer opacity-0"
              :aria-label="row.label"
              :checked="model[row.key]"
              :disabled="saving || loading"
              @change="updateBoolean(row.key, ($event.target as HTMLInputElement).checked)"
            >
            <span class="switch-track" aria-hidden="true">
              <span class="switch-thumb" />
            </span>
          </span>
        </label>
      </fieldset>

      <fieldset class="m-0 min-w-0 border-0 p-0">
        <legend class="w-full bg-surface-2 px-4 py-2 text-11px font-700 text-ink-soft">
          响应控制
        </legend>
        <div class="grid min-w-0 gap-3 p-4 sm:grid-cols-2">
          <label class="grid min-w-0 gap-1.5 text-11px text-ink-soft">
            <span class="font-700 text-ink">单次请求超时（秒）</span>
            <input
              type="number"
              class="form-input w-full"
              aria-label="单次请求超时（秒）"
              :min="OCR_TIMEOUT_LIMITS.requestTimeoutMs.min / 1000"
              :max="OCR_TIMEOUT_LIMITS.requestTimeoutMs.max / 1000"
              step="5"
              :value="model.requestTimeoutMs / 1000"
              :disabled="saving || loading"
              :aria-invalid="Boolean(timeoutErrors.requestTimeoutMs)"
              aria-describedby="ocr-request-timeout-help"
              @input="updateTimeout('requestTimeoutMs', ($event.target as HTMLInputElement).value)"
            >
            <span
              id="ocr-request-timeout-help"
              :role="timeoutErrors.requestTimeoutMs ? 'alert' : undefined"
              :class="timeoutErrors.requestTimeoutMs ? 'text-danger' : undefined"
            >
              {{ timeoutErrors.requestTimeoutMs || '允许 10–300 秒；仅影响单次提交或轮询请求。' }}
            </span>
          </label>
          <label class="grid min-w-0 gap-1.5 text-11px text-ink-soft">
            <span class="font-700 text-ink">任务轮询总超时（秒）</span>
            <input
              type="number"
              class="form-input w-full"
              aria-label="任务轮询总超时（秒）"
              :min="OCR_TIMEOUT_LIMITS.pollTimeoutMs.min / 1000"
              :max="OCR_TIMEOUT_LIMITS.pollTimeoutMs.max / 1000"
              step="30"
              :value="model.pollTimeoutMs / 1000"
              :disabled="saving || loading"
              :aria-invalid="Boolean(timeoutErrors.pollTimeoutMs)"
              aria-describedby="ocr-poll-timeout-help"
              @input="updateTimeout('pollTimeoutMs', ($event.target as HTMLInputElement).value)"
            >
            <span
              id="ocr-poll-timeout-help"
              :role="timeoutErrors.pollTimeoutMs ? 'alert' : undefined"
              :class="timeoutErrors.pollTimeoutMs ? 'text-danger' : undefined"
            >
              {{ timeoutErrors.pollTimeoutMs || '允许 60–1800 秒；较大文件可适当增加。' }}
            </span>
          </label>
        </div>
      </fieldset>

      <fieldset class="m-0 min-w-0 border-0 p-0">
        <legend class="w-full bg-surface-2 px-4 py-2 text-11px font-700 text-ink-soft">
          人工校对阈值
        </legend>
        <div class="grid min-w-0 gap-3 p-4 sm:grid-cols-2">
          <label class="grid min-w-0 gap-1.5 text-11px text-ink-soft">
            <span class="font-700 text-ink">建议通过阈值</span>
            <input
              aria-label="建议通过阈值"
              type="text"
              class="form-input w-full"
              :value="`${Math.round(model.passThreshold * 100)}%`"
              disabled
            >
          </label>
          <label class="grid min-w-0 gap-1.5 text-11px text-ink-soft">
            <span class="font-700 text-ink">注意阈值</span>
            <input
              aria-label="注意阈值"
              type="text"
              class="form-input w-full"
              :value="`${Math.round(model.attentionThreshold * 100)}%`"
              disabled
            >
          </label>
          <p class="m-0 rounded-[var(--radius-control)] bg-surface-2 px-3 py-2 text-11px leading-5 text-ink-faint sm:col-span-2">
            阈值尚未接入全局判读，当前仅展示代码固定值。接入发票与送货单统一校对逻辑前不可编辑，也不会随识别请求发送。
          </p>
        </div>
      </fieldset>
    </div>

    <footer class="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-panel px-4 py-3">
      <KitButton
        type="button"
        variant="secondary"
        :disabled="saving || loading"
        @click="emit('restoreDefault')"
      >
        恢复默认
      </KitButton>
      <KitButton
        type="button"
        variant="primary"
        :loading="saving"
        :disabled="!dirty || loading || saving || hasValidationErrors"
        @click="emit('save')"
      >
        保存设置
      </KitButton>
    </footer>
  </section>
</template>

<style scoped>
.setting-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1rem;
  cursor: pointer;
}

.setting-row:hover {
  background: var(--surface-3);
}

.switch-control {
  position: relative;
  display: inline-flex;
  flex: none;
}

.switch-track {
  display: flex;
  width: 2.25rem;
  height: 1.25rem;
  align-items: center;
  padding: 0.125rem;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--surface-3);
  transition: background-color var(--dur-fast), border-color var(--dur-fast);
}

.switch-thumb {
  display: block;
  width: 0.875rem;
  height: 0.875rem;
  border-radius: 999px;
  background: var(--panel);
  transition: transform var(--dur-fast);
}

.peer:checked + .switch-track {
  border-color: var(--brand);
  background: var(--brand);
}

.peer:checked + .switch-track .switch-thumb {
  transform: translateX(1rem);
}

.peer:focus-visible + .switch-track {
  outline: 2px solid color-mix(in srgb, var(--brand) 35%, transparent);
  outline-offset: 2px;
}
</style>
