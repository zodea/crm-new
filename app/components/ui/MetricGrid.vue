<script setup lang="ts">
// 指标网格（KitAtoms）：语义固定列数（禁 auto-fit），格子间 1px 分隔线。
// 基准：DC重构设计源码/kit/KitAtoms.jsx MetricGrid。
// 分隔线由 gap-[1px] 露出 bg-line 实现，格子白底来自 Metric 自带 bg-panel。
withDefaults(defineProps<{
  cols?: number
}>(), { cols: 5 })
</script>

<template>
  <div
    class="grid gap-[1px] overflow-hidden border border-line rounded-[10px] bg-line"
    :style="{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }"
  >
    <slot />
  </div>
</template>
