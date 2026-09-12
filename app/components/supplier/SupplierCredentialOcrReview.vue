<script setup lang="ts">
import type {
  CredentialCategorySuggestion,
  CredentialOcrDecision,
  CredentialOcrFieldChoice,
  CredentialOcrReviewDraft,
  CredentialOcrReviewField,
  CredentialOcrReviewGroup,
  resolveCredentialOcrReview,
} from '~/lib/supplier/credential-ocr'
import type { SupplierCredentialCategory } from '~/lib/supplier/detail'
import { computed, onMounted, reactive, shallowRef, useTemplateRef, watch } from 'vue'
import {
  buildCredentialOcrReview,
  resolveCredentialOcrChoices,
} from '~/lib/supplier/credential-ocr'
import { SUPPLIER_CREDENTIAL_CATEGORIES } from '~/lib/supplier/detail'
import SupplierCredentialOcrFieldReview from './SupplierCredentialOcrFieldReview.vue'

const props = withDefaults(defineProps<{
  fileName: string
  category: CredentialCategorySuggestion
  currentCategory?: SupplierCredentialCategory
  fields: readonly CredentialOcrReviewField[]
  currentLongTerm?: boolean
  recognizedLongTerm?: boolean | null
  draft?: CredentialOcrReviewDraft | null
  autofocus?: boolean
}>(), { autofocus: true })

const emit = defineEmits<{
  cancel: []
  draftChange: [draft: CredentialOcrReviewDraft]
  confirm: [payload: {
    category: SupplierCredentialCategory
    fields: ReturnType<typeof resolveCredentialOcrReview>
    decisions: Record<string, string>
    choices: CredentialOcrFieldChoice[]
    longTerm: boolean
  }]
}>()

const reviewRegion = useTemplateRef<HTMLElement>('reviewRegion')
const effectiveCurrentCategory = computed(
  () => props.currentCategory ?? props.category.category,
)
const categoryConflict = computed(
  () => effectiveCurrentCategory.value !== props.category.category,
)
const categoryDecision = shallowRef<CredentialOcrDecision>(
  props.draft?.categoryDecision ?? (categoryConflict.value ? 'keep-current' : 'use-recognized'),
)
const manualCategory = shallowRef<SupplierCredentialCategory>(props.draft?.manualCategory ?? effectiveCurrentCategory.value)
const resolvedCategory = computed(() => {
  if (categoryDecision.value === 'keep-current')
    return effectiveCurrentCategory.value
  if (categoryDecision.value === 'use-recognized')
    return props.category.category
  return manualCategory.value
})
const reviewGroups = reactive<CredentialOcrReviewGroup[]>([])
watch(() => props.fields, (fields) => {
  const normalized = buildCredentialOcrReview(fields, Object.fromEntries(fields.map(field => [field.key, field.currentValue])))
  for (const key of ['validFrom', 'expiresAt'] as const) {
    if (!normalized.some(field => field.key === key))
      normalized.push({ id: `manual-${key}`, key, label: key === 'validFrom' ? '生效日期' : '到期日期', value: '', confidence: 0, currentValue: '', decision: 'manual', manualValue: '', conflict: false })
  }
  const next = [...new Set(normalized.map(field => field.key))].map((key): CredentialOcrReviewGroup => {
    const candidates = normalized.filter(field => field.key === key)
    const current = candidates[0]!
    const previous = reviewGroups.find(group => group.key === key)
    const saved = props.draft?.choices.find(choice => choice.key === key)
    const selected = fields.find(field => field.key === key && field.decision !== 'keep-current') ?? current
    const conflict = candidates.some(field => field.conflict)
    return {
      key,
      label: current.label,
      currentValue: current.currentValue,
      candidates,
      conflict,
      decision: previous?.decision ?? saved?.decision ?? (conflict ? 'keep-current' : selected.decision),
      candidateId: previous?.candidateId ?? (saved?.decision === 'use-recognized' ? saved.candidateId : undefined) ?? candidates.find(field => field.value === selected.value)?.id ?? current.id!,
      manualValue: previous?.manualValue ?? (saved?.decision === 'manual' ? saved.manualValue : selected.manualValue),
    }
  })
  reviewGroups.splice(0, reviewGroups.length, ...next)
}, { immediate: true })
const longTermDecision = shallowRef<CredentialOcrDecision>(
  props.draft?.longTermDecision ?? (props.recognizedLongTerm == null
    || (props.currentLongTerm ?? false) !== props.recognizedLongTerm
    ? 'keep-current'
    : 'use-recognized'),
)
const manualLongTerm = shallowRef(props.draft?.manualLongTerm ?? false)
const resolvedLongTerm = computed(() => {
  if (longTermDecision.value === 'keep-current')
    return props.currentLongTerm ?? false
  if (longTermDecision.value === 'use-recognized')
    return props.recognizedLongTerm ?? props.currentLongTerm ?? false
  return manualLongTerm.value
})

const choices = computed<CredentialOcrFieldChoice[]>(() => reviewGroups.map(group => group.decision === 'keep-current'
  ? { key: group.key, decision: 'keep-current' }
  : group.decision === 'manual'
    ? { key: group.key, decision: 'manual', manualValue: group.manualValue }
    : { key: group.key, decision: 'use-recognized', candidateId: group.candidateId }))
const resolution = computed(() => {
  try {
    const fields = resolveCredentialOcrChoices(reviewGroups.flatMap(group => group.candidates), Object.fromEntries(reviewGroups.map(group => [group.key, group.currentValue])), choices.value)
    if (resolvedLongTerm.value)
      delete fields.expiresAt
    const dates = [fields.validFrom, fields.expiresAt].filter((value): value is string => Boolean(value))
    if (dates.some(value => !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
      || (fields.validFrom && fields.expiresAt && fields.validFrom > fields.expiresAt)) {
      return { fields: null, error: '请核对有效期，截止日期不能早于开始日期' }
    }
    return { fields, error: '' }
  }
  catch (cause) { return { fields: null, error: cause instanceof Error ? cause.message : '请核对人工选择' } }
})
const canConfirm = computed(() => resolution.value.fields !== null)
watch(() => JSON.stringify([choices.value, categoryDecision.value, manualCategory.value, longTermDecision.value, manualLongTerm.value]), () => {
  emit('draftChange', { choices: choices.value, categoryDecision: categoryDecision.value, manualCategory: manualCategory.value, longTermDecision: longTermDecision.value, manualLongTerm: manualLongTerm.value })
})

onMounted(() => {
  if (props.autofocus !== false)
    reviewRegion.value?.focus()
})

function keepAllCurrent() {
  for (const group of reviewGroups)
    group.decision = 'keep-current'
}

function confirmReview() {
  if (!canConfirm.value)
    return
  const fields = resolution.value.fields!
  emit('confirm', {
    category: resolvedCategory.value,
    fields,
    decisions: {
      ...Object.fromEntries(reviewGroups.map(group => [group.key, group.decision])),
      category: categoryDecision.value,
      longTerm: longTermDecision.value,
    },
    choices: choices.value,
    longTerm: resolvedLongTerm.value,
  })
}
</script>

<template>
  <section
    ref="reviewRegion"
    class="panel min-w-0 overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-brand"
    aria-labelledby="credential-ocr-title"
    aria-describedby="credential-ocr-guidance"
    tabindex="-1"
  >
    <p id="credential-ocr-guidance" class="sr-only" role="status" aria-live="polite">
      OCR 核对区已打开。请逐项检查类别、当前值、识别值与最终采用方式。
    </p>
    <header class="flex flex-wrap items-start gap-3 border-b border-line bg-surface-2 px-4 py-3">
      <div class="min-w-0 flex-1">
        <h4 id="credential-ocr-title" class="text-13px font-700 text-ink">
          核对 OCR 识别结果
        </h4>
        <p class="mt-1 truncate text-11px text-ink-faint" :title="fileName">
          {{ fileName }} · PaddleOCR-VL 1.6
        </p>
      </div>
      <span class="chip" :class="category.confidence >= 0.75 ? 'chip-ok' : 'chip-warn'">
        类别置信度 {{ Math.round(category.confidence * 100) }}%
      </span>
    </header>

    <div class="grid gap-4 p-4">
      <fieldset class="grid gap-2 border border-line bg-surface-2 p-3">
        <legend class="text-12px font-700 text-ink">
          证照类别
        </legend>
        <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-2 text-11px text-ink-soft">
          <p>当前：{{ effectiveCurrentCategory }}</p>
          <p>OCR 建议：{{ category.category }}</p>
          <p class="font-700 text-ink">
            最终：{{ resolvedCategory }}
          </p>
        </div>
        <span v-if="categoryConflict" class="chip chip-warn w-fit">类别存在冲突</span>
        <div class="flex flex-wrap gap-x-4 gap-y-2 text-11px">
          <label class="inline-flex items-center gap-1">
            <input v-model="categoryDecision" type="radio" name="category-decision" value="keep-current">
            保留当前类别
          </label>
          <label class="inline-flex items-center gap-1">
            <input v-model="categoryDecision" type="radio" name="category-decision" value="use-recognized">
            使用 OCR 建议
          </label>
          <label class="inline-flex items-center gap-1">
            <input v-model="categoryDecision" type="radio" name="category-decision" value="manual">
            手工选择类别
          </label>
        </div>
        <select
          v-if="categoryDecision === 'manual'"
          v-model="manualCategory"
          class="field-input w-full max-w-80"
          aria-label="手工确认的证照类别"
        >
          <option v-for="option in SUPPLIER_CREDENTIAL_CATEGORIES" :key="option" :value="option">
            {{ option }}
          </option>
        </select>
      </fieldset>

      <div class="flex flex-wrap items-center gap-2">
        <p class="mr-auto text-11px text-ink-faint">
          冲突项默认保留当前值；保存前请逐项核对。
        </p>
        <button type="button" class="btn-secondary" @click="keepAllCurrent">
          全部保留当前值
        </button>
      </div>

      <div class="max-w-full overflow-x-auto" tabindex="0" aria-label="OCR 字段核对表，可横向滚动">
        <div class="grid min-w-[48rem] gap-2">
          <SupplierCredentialOcrFieldReview v-for="group in reviewGroups" :key="group.key" :group="group" :long-term="resolvedLongTerm" @patch="Object.assign(group, $event)" />
        </div>
      </div>

      <fieldset class="grid gap-2 border border-line bg-surface-2 p-3">
        <legend class="text-12px font-700 text-ink">
          长期有效状态
        </legend>
        <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-2 text-11px text-ink-soft">
          <p>
            当前：{{ currentLongTerm ? '长期有效' : '固定期限' }}
          </p>
          <p>
            OCR：{{ recognizedLongTerm == null ? '未识别' : recognizedLongTerm ? '长期有效' : '固定期限' }}
          </p>
          <p class="font-700 text-ink">
            最终：{{ resolvedLongTerm ? '长期有效' : '固定期限' }}
          </p>
        </div>
        <div class="flex flex-wrap gap-x-4 gap-y-2 text-11px">
          <label class="inline-flex items-center gap-1">
            <input v-model="longTermDecision" type="radio" name="long-term-decision" value="keep-current">
            保留当前状态
          </label>
          <label class="inline-flex items-center gap-1">
            <input
              v-model="longTermDecision"
              type="radio"
              name="long-term-decision"
              value="use-recognized"
              :disabled="recognizedLongTerm == null"
            >
            使用识别状态
          </label>
          <label class="inline-flex items-center gap-1">
            <input v-model="longTermDecision" type="radio" name="long-term-decision" value="manual">
            手工确认
          </label>
          <label v-if="longTermDecision === 'manual'" class="inline-flex items-center gap-1">
            <input v-model="manualLongTerm" type="checkbox">
            手工设为长期有效
          </label>
        </div>
      </fieldset>

      <p v-if="resolution.error" class="text-11px text-danger" role="alert">
        {{ resolution.error }}
      </p>

      <footer class="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
        <button type="button" class="btn-secondary" @click="emit('cancel')">
          稍后核对
        </button>
        <button type="button" class="btn-primary" :disabled="!canConfirm" @click="confirmReview">
          保存核对结果
        </button>
      </footer>
    </div>
  </section>
</template>
