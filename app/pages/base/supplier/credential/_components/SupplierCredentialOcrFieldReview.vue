<script setup lang="ts">
import type { CredentialOcrReviewGroup } from '~/lib/supplier/credential-ocr'

defineProps<{ group: CredentialOcrReviewGroup, longTerm: boolean }>()
defineEmits<{ patch: [value: Partial<Pick<CredentialOcrReviewGroup, 'decision' | 'candidateId' | 'manualValue'>>] }>()
</script>

<template>
  <fieldset class="grid grid-cols-[8rem_minmax(9rem,1fr)_minmax(10rem,1fr)_minmax(18rem,1.4fr)] items-start gap-3 border border-line bg-panel p-3">
    <legend class="sr-only">
      {{ group.label }}
    </legend>
    <div>
      <p class="text-9px text-ink-faint">
        保存到
      </p>
      <p class="text-12px font-700 text-ink">
        {{ group.label }}
      </p>
      <span v-if="group.conflict" class="chip chip-warn mt-1">存在冲突</span>
      <span v-else-if="group.candidates.some(candidate => candidate.value)" class="chip chip-ok mt-1">可采用</span>
      <span v-else class="chip chip-warn mt-1">待人工录入</span>
      <p v-if="group.key === 'uniqueCode'" class="text-11px text-warn-ink">
        历史候选仍保留原目标；内部编码不能直接采用识别值，请保留当前或人工核对。
      </p>
    </div>
    <div class="min-w-0">
      <p class="text-9px text-ink-faint">
        当前值
      </p>
      <p class="mt-1 break-all text-12px text-ink-soft">
        {{ group.currentValue || '未录入' }}
      </p>
    </div>
    <div class="grid min-w-0 gap-2">
      <div v-for="candidate in group.candidates" :key="candidate.id">
        <p class="text-9px text-ink-faint">
          {{ candidate.sourceLabel || candidate.label }} · {{ Math.round(candidate.confidence * 100) }}%
        </p>
        <p class="mt-1 break-all text-12px text-ink">
          {{ candidate.value || '未识别' }}
        </p>
      </div>
    </div>
    <div class="grid min-w-0 gap-2">
      <div class="grid gap-2 text-11px">
        <label class="inline-flex items-center gap-1">
          <input type="radio" :name="`decision-${group.key}`" :checked="group.decision === 'keep-current'" @change="$emit('patch', { decision: 'keep-current' })">
          保留当前值
        </label>
        <label v-for="(candidate, index) in group.candidates" :key="candidate.id" class="inline-flex items-center gap-1">
          <input type="radio" :name="`decision-${group.key}`" :checked="group.decision === 'use-recognized' && group.candidateId === candidate.id" :disabled="!candidate.value || group.key === 'uniqueCode'" @change="$emit('patch', { decision: 'use-recognized', candidateId: candidate.id })">
          {{ group.candidates.length === 1 ? '使用识别值' : `使用识别值 ${index + 1}：${candidate.sourceLabel || candidate.label}` }}
        </label>
        <label class="inline-flex items-center gap-1">
          <input type="radio" :name="`decision-${group.key}`" :checked="group.decision === 'manual'" @change="$emit('patch', { decision: 'manual' })">
          手工修改
        </label>
      </div>
      <input v-if="group.decision === 'manual'" class="field-input w-full" :value="group.manualValue" :type="group.key === 'validFrom' || group.key === 'expiresAt' ? 'date' : 'text'" :aria-label="`${group.label}手工确认值`" :placeholder="`填写${group.label}`" :disabled="group.key === 'expiresAt' && longTerm" @input="$emit('patch', { manualValue: ($event.target as HTMLInputElement).value })">
    </div>
  </fieldset>
</template>
