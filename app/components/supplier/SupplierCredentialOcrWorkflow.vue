<script setup lang="ts">
import type { SupplierCredentialAction, SupplierCredentialOcrConfirmation, SupplierCredentialRecognition } from '~/lib/supplier/credential-contract'
import type { CredentialOcrDecision, CredentialOcrReviewDraft } from '~/lib/supplier/credential-ocr'
import type { createSupplierCredentialState, SupplierCredentialBaseline } from '~/lib/supplier/credential-state'
import { computed, shallowRef, watch } from 'vue'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'
import { buildCredentialOcrReview, CREDENTIAL_OCR_FIELD_KEYS, CREDENTIAL_OCR_FIELD_LABELS } from '~/lib/supplier/credential-ocr'
import { formatShanghaiDateTime } from '~/lib/util/datetime'
import { useOcrSettingsStore } from '~/stores/ocr-settings'
import SupplierCredentialOcrReview from './SupplierCredentialOcrReview.vue'

const props = defineProps<{ session: ReturnType<typeof createSupplierCredentialState>, credentialId: string, active: boolean, recognizeOnOpen: boolean }>()
const emit = defineEmits<{ close: [], busy: [value: boolean] }>()
const { confirm } = useKitUI()
const settings = useOcrSettingsStore()
const record = computed(() => props.session.data.value?.credentials.find(row => row.id === props.credentialId))
const reviewRecognition = shallowRef<SupplierCredentialRecognition | null>(null)
const draft = shallowRef<CredentialOcrReviewDraft | null>(null)
const base = shallowRef<SupplierCredentialBaseline | null>(null)
const pendingAction = shallowRef<SupplierCredentialAction | null>(null)
const preparing = shallowRef(false)
const dirty = shallowRef(false)
const message = shallowRef('')
const localError = shallowRef('')
const closeButton = shallowRef<HTMLButtonElement | null>(null)
let identity = ''
let epoch = 0
let autoStarted = false
const busy = computed(() => preparing.value || props.session.saving.value || props.session.loading.value)
const newRecognition = computed(() => record.value?.recognition && record.value.recognition.id !== reviewRecognition.value?.id ? record.value.recognition : null)
const canRecognize = computed(() => props.session.canWrite.value && record.value?.file?.state === 'available')
const canConfirm = computed(() => canRecognize.value && props.session.data.value?.capabilities.includes('supplier:write') && props.session.data.value.masterValues !== undefined)
const fields = computed(() => {
  const current = record.value
  if (!reviewRecognition.value || !current)
    return []
  const values = { ...props.session.data.value?.masterValues, validFrom: current.validFrom, expiresAt: current.expiresAt }
  const result = buildCredentialOcrReview(reviewRecognition.value.parsed.fields, values)
  for (const key of ['validFrom', 'expiresAt'] as const) {
    if (!result.some(field => field.key === key))
      result.push({ id: `manual-${key}`, key, label: key === 'validFrom' ? '生效日期' : '到期日期', value: '', currentValue: values[key], confidence: 0, decision: values[key] ? 'keep-current' : 'manual', manualValue: '', conflict: false })
  }
  return result
})
const history = computed(() => record.value && (Object.keys(record.value.ocrResult).length || Object.keys(record.value.ocrConfirmedResult).length || record.value.ocrConfirmedAt)
  ? JSON.stringify({ 原始识别记录: record.value.ocrResult, 历史人工确认: record.value.ocrConfirmedResult, 确认时间: record.value.ocrConfirmedAt ?? '未确认' }, null, 2)
  : '')
const previousConfirmation = computed(() => {
  const current = record.value
  if (!current || (!current.ocrConfirmedAt && !Object.keys(current.ocrConfirmedResult).length))
    return null
  const result = current.ocrConfirmedResult
  const values = result.fields && typeof result.fields === 'object' && !Array.isArray(result.fields) ? result.fields as Record<string, unknown> : {}
  const decisions = result.decisions && typeof result.decisions === 'object' && !Array.isArray(result.decisions) ? result.decisions as Record<string, unknown> : {}
  const decisionLabel = (value: unknown) => value === 'keep-current' ? '保留当时值' : value === 'use-recognized' ? '采用识别建议' : value === 'manual' ? '人工修改' : '历史未记录采用方式'
  return {
    time: formatShanghaiDateTime(current.ocrConfirmedAt, '历史时间未知'),
    category: typeof result.category === 'string' ? `${result.category} · ${decisionLabel(decisions.category)}` : '历史未记录类别',
    longTerm: typeof result.longTerm === 'boolean' ? `${result.longTerm ? '长期有效' : '固定期限'} · ${decisionLabel(decisions.longTerm)}` : '历史未记录期限决定',
    fields: CREDENTIAL_OCR_FIELD_KEYS.filter(key => typeof values[key] === 'string').map(key => `${CREDENTIAL_OCR_FIELD_LABELS[key]}：${values[key] || '留空'}`),
  }
})
const locked = computed(() => busy.value || !!pendingAction.value || props.session.conflict.value || !!newRecognition.value || !canConfirm.value)
watch(busy, value => emit('busy', value), { immediate: true })

function adoptRecognition() {
  reviewRecognition.value = record.value?.recognition ?? null
  draft.value = null
  dirty.value = false
  base.value = props.session.baseline()
}
watch(() => [props.credentialId, props.session.data.value?.supplierId, props.session.data.value?.dataOrigin], () => {
  const data = props.session.data.value
  if (!data)
    return
  const next = JSON.stringify([data.supplierId, data.dataOrigin, props.credentialId])
  if (next === identity)
    return
  // 自动识别只属于打开弹窗时的目标；目标改变必须重新明确发起。
  autoStarted = identity !== ''
  identity = next
  epoch++
  pendingAction.value = null
  preparing.value = false
  message.value = ''
  localError.value = ''
  adoptRecognition()
}, { immediate: true })
watch(() => [props.active, props.recognizeOnOpen, canRecognize.value], () => {
  if (props.active && props.recognizeOnOpen && canRecognize.value && !autoStarted) {
    autoStarted = true
    void recognize()
  }
}, { immediate: true })

function isCurrent(sequence: number) {
  return sequence === epoch && props.active
}
async function mayClose() {
  if (busy.value || pendingAction.value)
    return false
  if (!dirty.value)
    return true
  const sequence = epoch
  const accepted = await confirm({ variant: 'simple', title: '放弃未保存的核对输入？', message: '识别候选已保存，当前人工选择尚未保存；确认放弃后可稍后重新核对。', confirmLabel: '放弃输入' })
  return accepted && sequence === epoch && !busy.value
}
async function close() {
  if (await mayClose())
    emit('close')
}
function focusClose(event: Event) {
  event.preventDefault()
  closeButton.value?.focus()
}
function keepDraft(value: CredentialOcrReviewDraft) {
  draft.value = value
  dirty.value = true
}
async function execute(action: SupplierCredentialAction) {
  const sequence = epoch
  pendingAction.value = action
  localError.value = ''
  try {
    await props.session.execute(action, base.value)
    if (!isCurrent(sequence))
      return
    pendingAction.value = null
    if (action.action === 'ocr-confirm') {
      dirty.value = false
      emit('close')
    }
    else {
      adoptRecognition()
      message.value = '识别候选已保存，请人工核对；也可以稍后继续。'
    }
  }
  catch (cause) {
    if (!isCurrent(sequence))
      return
    localError.value = cause instanceof Error ? cause.message : '识别操作失败，请重试'
    if (!props.session.hasPending(action, base.value))
      pendingAction.value = null
  }
}
async function recognize() {
  if (!props.active || busy.value || pendingAction.value || !canRecognize.value || props.session.conflict.value)
    return
  const sequence = epoch
  if (dirty.value && !await mayClose())
    return
  if (!isCurrent(sequence))
    return
  preparing.value = true
  localError.value = ''
  try {
    await settings.load()
    if (!isCurrent(sequence))
      return
    await execute({ action: 'ocr-recognize', credentialId: props.credentialId, options: { ...settings.recognitionOptions } })
  }
  catch (cause) {
    if (isCurrent(sequence))
      localError.value = cause instanceof Error ? cause.message : 'OCR 设置读取失败，请重试'
  }
  finally {
    if (sequence === epoch)
      preparing.value = false
  }
}
async function save(value: Omit<SupplierCredentialOcrConfirmation, 'recognitionId' | 'decisions'> & { decisions: Record<string, string> }) {
  if (locked.value || !reviewRecognition.value || !props.active)
    return
  await execute({ action: 'ocr-confirm', credentialId: props.credentialId, draft: { recognitionId: reviewRecognition.value.id, category: value.category, longTerm: value.longTerm, choices: value.choices, decisions: { category: value.decisions.category as CredentialOcrDecision, longTerm: value.decisions.longTerm as CredentialOcrDecision } } })
}
async function recover() {
  if (!busy.value && pendingAction.value && props.active)
    await execute(pendingAction.value)
}
async function recheck() {
  if (busy.value)
    return
  const recovering = pendingAction.value !== null
  const sequence = epoch
  preparing.value = true
  try {
    const next = await props.session.recheck()
    if (!isCurrent(sequence))
      return
    if (!recovering)
      base.value = next
    localError.value = ''
    message.value = recovering ? '已重新读取权限和当前资料；原提交与人工选择继续保留，请恢复原提交核对结果。' : '已重新读取当前资料；人工选择继续保留，请核对后再保存。'
  }
  catch (cause) {
    if (isCurrent(sequence))
      localError.value = cause instanceof Error ? cause.message : '重新核对失败'
  }
  finally {
    if (sequence === epoch)
      preparing.value = false
  }
}
async function reviewNewRecognition() {
  if (busy.value || pendingAction.value || !newRecognition.value || !await mayClose())
    return
  adoptRecognition()
  message.value = '已切换到最新识别结果，请重新逐项选择。'
}
defineExpose({ mayClose })
</script>

<template>
  <Dialog :open="active" @update:open="value => { if (!value) void close() }">
    <DialogContent :show-close="false" class="grid max-h-[90dvh] w-[min(68rem,calc(100vw-2rem))] grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0" @interact-outside.prevent @open-auto-focus="focusClose" @close-auto-focus.prevent>
      <header class="flex items-start gap-3 border-b border-line p-4">
        <div class="min-w-0 flex-1">
          <DialogTitle>证照识别与人工核对</DialogTitle>
          <DialogDescription class="mb-0 mt-1 break-all text-12px text-ink-soft">
            {{ record?.file?.fileName || record?.category || '当前证照' }} · 识别结果需人工确认后才写入资料。
          </DialogDescription>
        </div>
        <button ref="closeButton" type="button" class="btn-secondary shrink-0" :aria-disabled="busy || !!pendingAction" @click="close">
          关闭
        </button>
      </header>
      <div class="grid min-h-0 min-w-0 gap-3 overflow-y-auto p-4">
        <p v-if="busy" class="text-12px text-ink-soft" role="status">
          正在处理，请等待结果…
        </p>
        <p v-if="message" class="text-12px text-ink-soft" role="status">
          {{ message }}
        </p>
        <p v-if="localError" class="border border-danger/30 bg-danger-soft p-3 text-12px text-danger-ink" role="alert">
          {{ localError }}
        </p>
        <div v-if="pendingAction && !busy" class="grid gap-2 border border-line bg-surface-2 p-3">
          <p class="text-12px text-ink-soft">
            上次提交结果尚未确认，输入已保留，请恢复原提交核对结果。
          </p>
          <button type="button" class="btn-primary justify-self-start" @click="recover">
            恢复原提交
          </button>
        </div>
        <button v-if="pendingAction || session.conflict.value || (!session.data.value && !busy)" type="button" class="btn-secondary justify-self-start" :disabled="busy" @click="recheck">
          重新核对当前资料
        </button>
        <div v-if="newRecognition" class="grid gap-2 border border-line bg-surface-2 p-3">
          <p class="text-12px text-ink-soft">
            这份原件已有新的识别结果，当前选择仍属于上一份结果。
          </p>
          <button type="button" class="btn-secondary justify-self-start" :disabled="busy || !!pendingAction" @click="reviewNewRecognition">
            核对新识别结果
          </button>
        </div>
        <p v-if="record?.recognition?.historical" class="text-12px text-warn-ink">
          历史识别结果，原字段含义保留；请核对实际目标与当前值。
        </p>
        <p v-if="!record || record.file?.state !== 'available'" class="text-12px text-warn-ink">
          此证照缺少可读取的原件，保留的历史记录仅作线索；请先补齐原件。
        </p>
        <p v-else-if="!canConfirm" class="text-12px text-warn-ink">
          当前没有分供方主档写入权限，不能查看当前主档值或保存人工确认。
        </p>
        <fieldset v-if="reviewRecognition && record && canConfirm" :disabled="locked" class="m-0 min-w-0 border-0 p-0">
          <SupplierCredentialOcrReview :key="`${identity}:${reviewRecognition.id}`" :file-name="record.file?.fileName || record.category" :category="reviewRecognition.parsed.category" :current-category="record.category" :fields="fields" :current-long-term="record.longTerm" :recognized-long-term="reviewRecognition.parsed.longTerm" :draft="draft" :autofocus="false" @draft-change="keepDraft" @confirm="save" @cancel="close" />
        </fieldset>
        <details v-if="reviewRecognition" class="min-w-0 border border-line p-3 text-12px">
          <summary class="cursor-pointer">
            识别原文 · {{ reviewRecognition.recognizedAt || '历史时间未知' }}
          </summary>
          <pre class="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all font-sans">{{ reviewRecognition.parsed.rawText }}</pre>
        </details>
        <details v-if="history" class="min-w-0 border border-line p-3 text-12px">
          <summary class="cursor-pointer">
            历史识别与人工确认记录
          </summary>
          <section v-if="previousConfirmation" class="mt-3 grid gap-2 border border-line bg-surface-2 p-3" aria-label="上次人工确认">
            <strong>上次人工确认</strong>
            <p class="m-0">
              确认时间：{{ previousConfirmation.time }}
            </p>
            <p class="m-0">
              证照类别：{{ previousConfirmation.category }}
            </p>
            <p class="m-0">
              有效期限：{{ previousConfirmation.longTerm }}
            </p>
            <p v-for="field in previousConfirmation.fields" :key="field" class="m-0 break-all">
              {{ field }}
            </p>
          </section>
          <p v-else class="mb-0 mt-2 text-ink-soft">
            尚无人工确认记录。
          </p>
          <details class="mt-3">
            <summary class="cursor-pointer text-ink-soft">
              原始记录
            </summary>
            <pre class="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all font-sans">{{ history }}</pre>
          </details>
        </details>
        <button type="button" class="btn-secondary justify-self-start" :disabled="busy || !!pendingAction || !canRecognize || session.conflict.value" @click="recognize">
          {{ reviewRecognition || history ? '重新识别原件' : '识别原件' }}
        </button>
      </div>
    </DialogContent>
  </Dialog>
</template>
