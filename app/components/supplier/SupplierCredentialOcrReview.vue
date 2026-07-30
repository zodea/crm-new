<script setup lang="ts">
import type {
  CredentialCategorySuggestion,
  CredentialOcrDecision,
  CredentialOcrReviewField,
} from '~/lib/supplier/credential-ocr'
import type { SupplierCredentialCategory } from '~/lib/supplier/detail'
import { computed, onMounted, reactive, shallowRef, useTemplateRef } from 'vue'
import {
  resolveCredentialOcrReview,
} from '~/lib/supplier/credential-ocr'
import { SUPPLIER_CREDENTIAL_CATEGORIES } from '~/lib/supplier/detail'

const props = defineProps<{
  fileName: string
  category: CredentialCategorySuggestion
  currentCategory?: SupplierCredentialCategory
  fields: readonly CredentialOcrReviewField[]
  currentLongTerm?: boolean
  recognizedLongTerm?: boolean | null
}>()

const emit = defineEmits<{
  cancel: []
  confirm: [payload: {
    category: SupplierCredentialCategory
    fields: ReturnType<typeof resolveCredentialOcrReview>
    decisions: Record<string, string>
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
  categoryConflict.value ? 'keep-current' : 'use-recognized',
)
const manualCategory = shallowRef<SupplierCredentialCategory>(effectiveCurrentCategory.value)
const resolvedCategory = computed(() => {
  if (categoryDecision.value === 'keep-current')
    return effectiveCurrentCategory.value
  if (categoryDecision.value === 'use-recognized')
    return props.category.category
  return manualCategory.value
})
const reviewFields = reactive<CredentialOcrReviewField[]>(props.fields.map(field => ({ ...field })))
for (const dateField of [
  { key: 'validFrom' as const, label: '生效日期' },
  { key: 'expiresAt' as const, label: '到期日期' },
]) {
  if (!reviewFields.some(field => field.key === dateField.key)) {
    reviewFields.push({
      ...dateField,
      value: '',
      confidence: 0,
      currentValue: '',
      decision: 'manual',
      manualValue: '',
      conflict: false,
    })
  }
}
const longTermDecision = shallowRef<CredentialOcrDecision>(
  props.recognizedLongTerm == null
  || (props.currentLongTerm ?? false) !== props.recognizedLongTerm
    ? 'keep-current'
    : 'use-recognized',
)
const manualLongTerm = shallowRef(false)
const resolvedLongTerm = computed(() => {
  if (longTermDecision.value === 'keep-current')
    return props.currentLongTerm ?? false
  if (longTermDecision.value === 'use-recognized')
    return props.recognizedLongTerm ?? props.currentLongTerm ?? false
  return manualLongTerm.value
})

const unresolvedManualFields = computed(() =>
  reviewFields.filter(field =>
    field.decision === 'manual'
    && field.key !== 'validFrom'
    && field.key !== 'expiresAt'
    && !field.manualValue.trim(),
  ),
)
const canConfirm = computed(() => unresolvedManualFields.value.length === 0)

onMounted(() => {
  reviewRegion.value?.focus()
})

function keepAllCurrent() {
  for (const field of reviewFields) {
    if (field.currentValue)
      field.decision = 'keep-current'
  }
}

function confirmReview() {
  if (!canConfirm.value)
    return
  const fields = resolveCredentialOcrReview(reviewFields)
  if (resolvedLongTerm.value)
    delete fields.expiresAt
  emit('confirm', {
    category: resolvedCategory.value,
    fields,
    decisions: {
      ...Object.fromEntries(reviewFields.map(field => [field.key, field.decision])),
      category: categoryDecision.value,
      longTerm: longTermDecision.value,
    },
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
          <fieldset
            v-for="field in reviewFields"
            :key="field.key"
            class="grid grid-cols-[8rem_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(18rem,1.4fr)] items-start gap-3 border border-line bg-panel p-3"
          >
            <legend class="sr-only">
              {{ field.label }}
            </legend>
            <div>
              <p class="text-12px font-700 text-ink">
                {{ field.label }}
              </p>
              <span v-if="field.conflict" class="chip chip-warn mt-1">存在冲突</span>
              <span v-else-if="field.value" class="chip chip-ok mt-1">可采用</span>
              <span v-else class="chip chip-warn mt-1">待人工录入</span>
            </div>
            <div class="min-w-0">
              <p class="text-9px text-ink-faint">
                当前值
              </p>
              <p class="mt-1 break-all text-12px text-ink-soft">
                {{ field.currentValue || '未录入' }}
              </p>
            </div>
            <div class="min-w-0">
              <p class="text-9px text-ink-faint">
                识别值 · {{ Math.round(field.confidence * 100) }}%
              </p>
              <p class="mt-1 break-all text-12px text-ink">
                {{ field.value || '未识别' }}
              </p>
            </div>
            <div class="grid min-w-0 gap-2">
              <div class="flex flex-wrap gap-x-3 gap-y-1 text-11px">
                <label class="inline-flex items-center gap-1">
                  <input v-model="field.decision" type="radio" :name="`decision-${field.key}`" value="keep-current">
                  保留当前值
                </label>
                <label class="inline-flex items-center gap-1">
                  <input v-model="field.decision" type="radio" :name="`decision-${field.key}`" value="use-recognized">
                  使用识别值
                </label>
                <label class="inline-flex items-center gap-1">
                  <input v-model="field.decision" type="radio" :name="`decision-${field.key}`" value="manual">
                  手工修改
                </label>
              </div>
              <input
                v-if="field.decision === 'manual'"
                v-model="field.manualValue"
                class="field-input w-full"
                :type="field.key === 'validFrom' || field.key === 'expiresAt' ? 'date' : 'text'"
                :aria-label="`${field.label}手工确认值`"
                :placeholder="`填写${field.label}`"
                :disabled="field.key === 'expiresAt' && resolvedLongTerm"
              >
            </div>
          </fieldset>
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

      <p v-if="unresolvedManualFields.length" class="text-11px text-danger" role="alert">
        请填写手工确认值：{{ unresolvedManualFields.map(field => field.label).join('、') }}
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
