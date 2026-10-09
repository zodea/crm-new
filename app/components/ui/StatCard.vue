<script setup lang="ts">
// 指标卡的共享内核。standalone 保留独立卡片/点击筛选，grid 由 Metric 适配。
// 取值、金额口径、来源状态和跳转目标均由调用页提供，不读取领域 store。
import type { RouteLocationRaw } from 'vue-router'
import { computed } from 'vue'
import { formatMoney } from '~/lib/util/money'
import ContextHelp from './ContextHelp.vue'
import MoneyLink from './MoneyLink.vue'

const props = withDefaults(defineProps<{
  label: string
  value: string | number
  variant?: 'standalone' | 'grid'
  icon?: string
  color?: 'brand' | 'ok' | 'danger' | 'warn'
  suffix?: string
  /** value 为数字金额时置 true，按 #,##0.00 两位小数展示。 */
  money?: boolean
  /** 可点汇总卡（点击切筛选，如工人页/台账页签），渲染为 button。 */
  clickable?: boolean
  /** 网格适配保留原 Metric 的货币前缀和来源说明。 */
  currency?: boolean
  formula?: string
  big?: boolean
  to?: RouteLocationRaw | null
  status?: string
  cutoff?: string
  missingSources?: string
}>(), { variant: 'standalone', money: false, clickable: false, currency: false, to: null })

const grid = computed(() => props.variant === 'grid')

const display = computed(() =>
  props.money && typeof props.value === 'number'
    ? formatMoney(props.value, { currency: props.currency })
    : props.value,
)

const colorClass: Record<string, string> = {
  brand: 'text-brand',
  ok: 'text-ok',
  danger: 'text-danger',
  warn: 'text-warn',
}
const gridColorClass: Record<string, string> = {
  brand: 'text-brand',
  ok: 'text-ok-ink',
  danger: 'text-danger-ink',
  warn: 'text-warn-ink',
}
</script>

<template>
  <component
    :is="clickable ? 'button' : 'div'"
    :type="clickable ? 'button' : undefined"
    :role="grid && !clickable ? 'group' : undefined"
    :aria-label="grid ? label : undefined"
    :aria-description="clickable ? formula : undefined"
    :class="[
      grid ? 'min-w-0 bg-panel px-[14px] py-[12px]' : 'panel px-4 py-3',
      clickable ? 'panel-hover w-full cursor-pointer text-left font-sans focus-visible:[outline:2px_solid_var(--brand)] focus-visible:[outline-offset:2px]' : undefined,
    ]"
  >
    <div class="flex items-center" :class="grid ? 'gap-[4px] text-[12px] font-600 text-ink-faint' : 'gap-2 mb-1.5'">
      <span v-if="icon" :class="icon" class="text-16px text-ink-faint" aria-hidden="true" />
      <span :class="grid ? 'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap' : 'text-12px font-700 text-ink-soft'">{{ label }}</span>
      <ContextHelp v-if="formula && !clickable" :label="label" :text="formula" />
    </div>
    <div
      class="font-mono tabular-nums"
      :class="[
        grid ? ['mt-[5px] whitespace-nowrap tracking-[-0.015em] leading-[1.25]', big ? 'text-[17.5px] font-800' : 'text-[13.5px] font-700'] : 'text-24px font-800 leading-[1.1]',
        color ? (grid ? gridColorClass[color] : colorClass[color]) : 'text-ink',
      ]"
      :title="grid && typeof value === 'string' ? value : undefined"
    >
      <MoneyLink v-if="to != null && money && typeof value === 'number' && !clickable" :value="value" :to="to" />
      <template v-else>
        {{ display }}
      </template>
      <span v-if="suffix" class="text-12px font-400 text-ink-faint ml-0.5">{{ suffix }}</span>
    </div>
    <dl v-if="status || cutoff || missingSources" class="mt-2 space-y-0.5 border-t border-line-soft pt-2 text-10px leading-4 text-ink-faint">
      <div v-if="status" class="flex min-w-0 gap-1">
        <dt class="shrink-0">
          状态
        </dt>
        <dd class="min-w-0 truncate" :title="status">
          {{ status }}
        </dd>
      </div>
      <div v-if="cutoff" class="flex min-w-0 gap-1">
        <dt class="shrink-0">
          汇总截止
        </dt>
        <dd class="min-w-0 truncate" :title="cutoff">
          {{ cutoff }}
        </dd>
      </div>
      <div v-if="missingSources" class="flex min-w-0 gap-1">
        <dt class="shrink-0">
          缺失来源
        </dt>
        <dd class="min-w-0 truncate" :title="missingSources">
          {{ missingSources }}
        </dd>
      </div>
    </dl>
  </component>
</template>
