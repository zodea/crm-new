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
  <section data-testid="factor-config-panel" class="min-w-0 self-start overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel lg:max-h-full lg:overflow-y-auto lg:overscroll-contain">
    <div class="flex items-center justify-between gap-3 px-3 py-2.5">
      <div>
        <h2 class="text-13px font-800 text-ink">
          开票因子（单价）
        </h2>
      </div>
      <KitButton type="button" class="shrink-0" @click="addFactor">
        <span class="i-lucide-plus mr-1 text-12px" />添加因子
      </KitButton>
    </div>

    <div class="border-y border-line">
      <div class="grid grid-cols-[minmax(0,1fr)_76px_40px_26px] items-center gap-1.5 bg-surface-2 px-2.5 py-2 text-10px font-700 text-ink-faint">
        <span>因子值</span>
        <span class="text-right">最大数量</span>
        <span class="text-center">小数</span>
        <span />
      </div>
      <div
        v-for="factor in props.factors"
        :key="factor.id"
        class="grid grid-cols-[minmax(0,1fr)_76px_40px_26px] items-center gap-1.5 border-t border-line px-2.5 py-2"
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
          <input :checked="factor.allowDecimal" :aria-label="`因子 ${factor.id} 允许小数数量`" type="checkbox" class="accent-brand" @change="updateDecimal(factor.id, $event)">
        </label>
        <button
          type="button"
          class="icon-btn-danger h-7 w-7 border-transparent bg-transparent active:scale-97"
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
    <div class="p-3">
      <slot name="controls" />
    </div>
  </section>
</template>
