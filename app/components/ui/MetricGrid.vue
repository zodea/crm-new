<script setup lang="ts">
// 指标网格（KitAtoms）：cols 仅表示宽屏最大列数；空间不足时按最小可读宽度自动降列。
// 基准：DC重构设计源码/kit/KitAtoms.jsx MetricGrid。
// 空余单元保持白底，分隔线只围绕实际指标，避免换行后露出大块灰色填充。
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
    class="metric-grid grid gap-[1px] overflow-hidden border border-line rounded-[var(--radius-card)] bg-panel"
    :style="{ gridTemplateColumns }"
  >
    <slot />
  </div>
</template>

<style scoped>
.metric-grid > :deep(*) {
  min-width: 0;
  box-shadow: 0 0 0 1px var(--line);
}
</style>
