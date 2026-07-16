<script setup lang="ts">
import type { FactorDraft, NumericDraft } from '~/types/finance-factor'

interface Props {
  factors: FactorDraft[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:factors': [factors: FactorDraft[]]
}>()

function addFactor() {
  const nextId = props.factors.reduce((maximum, factor) => Math.max(maximum, factor.id), 0) + 1
  emit('update:factors', [
    ...props.factors,
    { id: nextId, value: null, maxQuantity: null, allowDecimal: false },
  ])
}

function removeFactor(id: number) {
  emit('update:factors', props.factors.filter(factor => factor.id !== id))
}

function updateNumber(
  id: number,
  key: 'value' | 'maxQuantity',
  event: Event,
) {
  const rawValue = (event.currentTarget as HTMLInputElement).value
  const value: NumericDraft = rawValue === '' ? '' : Number(rawValue)
  emit('update:factors', props.factors.map(factor => factor.id === id
    ? { ...factor, [key]: value }
    : factor))
}

function updateDecimal(id: number, event: Event) {
  const allowDecimal = (event.currentTarget as HTMLInputElement).checked
  emit('update:factors', props.factors.map(factor => factor.id === id
    ? { ...factor, allowDecimal }
    : factor))
}
</script>

<template>
  <section class="min-w-0 p-4 xl:border-r xl:border-line" style="background-color: var(--panel)">
    <div class="mb-3 flex items-start justify-between gap-3">
      <div>
        <h2 class="text-13px font-800 text-ink">
          因子配置
        </h2>
        <p class="mt-0.5 text-10px leading-4 text-ink-faint">
          小数数量仅生成单价乘数量恰为整分的组合
        </p>
      </div>
      <button type="button" class="btn-secondary shrink-0 text-12px active:translate-y-px" @click="addFactor">
        <span class="i-lucide-plus mr-1 text-12px" />添加因子
      </button>
    </div>

    <div class="overflow-hidden rounded-[var(--radius-btn)] border border-line">
      <div class="grid grid-cols-[minmax(0,1fr)_124px_62px_34px] items-center gap-1 bg-surface-2 px-2.5 py-2 text-10px font-700 text-ink-faint">
        <span>因子值</span>
        <span class="text-right">最大次数/数量</span>
        <span class="text-center">小数</span>
        <span />
      </div>
      <div
        v-for="factor in props.factors"
        :key="factor.id"
        class="grid grid-cols-[minmax(0,1fr)_124px_62px_34px] items-center gap-1.5 border-t border-line px-2.5 py-2"
      >
        <input
          :value="factor.value ?? ''"
          type="number"
          min="0"
          step="any"
          class="field-input min-w-0 w-full !px-2 !py-1 font-mono text-12px"
          placeholder="数值"
          :aria-label="`因子 ${factor.id} 的数值`"
          @input="updateNumber(factor.id, 'value', $event)"
        >
        <input
          :value="factor.maxQuantity ?? ''"
          type="number"
          min="0"
          step="any"
          class="field-input min-w-0 w-full !px-2 !py-1 text-right font-mono text-12px"
          placeholder="不限"
          :aria-label="`因子 ${factor.id} 的最大数量`"
          @input="updateNumber(factor.id, 'maxQuantity', $event)"
        >
        <label class="flex cursor-pointer items-center justify-center gap-1 text-11px text-ink-soft">
          <input :checked="factor.allowDecimal" type="checkbox" class="accent-brand" @change="updateDecimal(factor.id, $event)">
          <span>是</span>
        </label>
        <button
          type="button"
          class="icon-btn-danger h-7 w-7 border-transparent bg-transparent active:translate-y-px"
          :aria-label="`删除因子 ${factor.id}`"
          @click="removeFactor(factor.id)"
        >
          <span class="i-lucide-x text-13px" />
        </button>
      </div>
      <div v-if="props.factors.length === 0" class="px-3 py-8 text-center text-12px text-ink-faint">
        暂无因子，点击“添加因子”开始配置
      </div>
    </div>
  </section>
</template>
