<script setup lang="ts">
// 指标网格（KitAtoms）：cols 仅表示宽屏最大列数；空间不足时按最小可读宽度自动降列。
// 基准：DC重构设计源码/kit/KitAtoms.jsx MetricGrid。
// 分隔线由 gap-[1px] 露出 bg-line 实现，格子白底来自 Metric 自带 bg-panel。
const props = withDefaults(defineProps<{
  cols?: number
}>(), { cols: 5 })

const gridTemplateColumns = computed(() => {
  const cols = Math.max(1, Math.trunc(props.cols))
  const totalGap = Math.max(0, cols - 1)
  const maxColumnWidth = `calc((100% - ${totalGap}px) / ${cols})`

  return `repeat(auto-fit, minmax(min(100%, max(160px, ${maxColumnWidth})), 1fr))`
})
</script>

<template>
  <div
    class="grid gap-[1px] overflow-hidden border border-line rounded-[var(--radius-card)] bg-line shadow-[var(--shadow-card)]"
    :style="{ gridTemplateColumns }"
  >
    <slot />
  </div>
</template>
