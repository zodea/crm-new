<script setup lang="ts">
import type { QuantityStageProgress } from '~/lib/quantity/derived'

const props = defineProps<{
  progress: readonly QuantityStageProgress[]
}>()

// 领域层统一进度（ADR 0010）：页面只渲染，不重新统计；同一分项映射多个阶段=多张独立卡。
const cards = computed(() => props.progress.map(stage => ({
  ...stage,
  percent: Math.round(stage.completionRate * 100),
})))
</script>

<template>
  <section
    v-if="cards.length"
    class="panel min-w-0 px-4 py-3"
    aria-label="阶段进度"
  >
    <div class="flex items-baseline gap-2">
      <h3 class="text-13px font-800 text-ink">
        阶段进度
      </h3>
      <span class="text-11px text-ink-faint">已完成 ÷ 应做户数；应做按户型模板量明细计算</span>
    </div>
    <div class="quantity-progress-grid mt-3 grid gap-2.5">
      <article
        v-for="stage in cards"
        :key="stage.stageId"
        class="min-w-0 border border-line rounded-[var(--radius-btn)] bg-surface-2 px-3 py-2.5"
        :aria-label="`${stage.stageName}进度 ${stage.percent}%`"
      >
        <div class="flex min-w-0 items-baseline gap-2">
          <span class="truncate text-12px font-800 text-ink">{{ stage.stageName }}</span>
          <span class="flex-none text-11px text-ink-faint">{{ stage.trade }}</span>
          <span class="ml-auto flex-none text-12px font-800 font-mono" :class="stage.percent >= 100 ? 'text-ok' : 'text-ink'">
            {{ stage.percent }}%
          </span>
        </div>
        <ProgressBar
          class="mt-2"
          :percent="Math.min(stage.percent, 100)"
          :tone="stage.percent >= 100 ? 'ok' : 'brand'"
          :label="`${stage.stageName}进度`"
          :valuetext="`已完成 ${stage.completedUnits} / 应做 ${stage.applicableUnits} 户`"
        />
        <div class="mt-1.5 flex items-center gap-2 text-11px text-ink-soft font-mono tabular-nums">
          <span>{{ stage.completedUnits }}/{{ stage.applicableUnits }} 户</span>
          <span v-if="stage.draftUnits" class="text-warn-ink">草稿 {{ stage.draftUnits }}</span>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.quantity-progress-grid {
  grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr));
}
</style>
