<script setup lang="ts">
// 区块标题：≤34px 浅灰层级条 + 3×14 品牌竖条。
// 已有调用同时使用默认插槽和 title/subtitle 属性；右侧操作走 #extra 插槽。
withDefaults(defineProps<{
  mb?: number
  title?: string
  subtitle?: string
}>(), {
  mb: 12,
  subtitle: '',
  title: '',
})
</script>

<template>
  <div
    data-ui="section-header"
    class="section-heading"
    :style="{ marginBottom: `${mb}px` }"
  >
    <span aria-hidden="true" class="h-3.5 w-[3px] flex-none rounded-[1px] bg-brand" />
    <h2 class="m-0 shrink-0 text-[13px] font-700 text-ink">
      <slot>{{ title }}</slot>
    </h2>
    <span v-if="subtitle" class="min-w-0 truncate text-[11px] text-ink-faint" :title="subtitle">{{ subtitle }}</span>
    <span v-if="$slots.extra" class="ml-auto"><slot name="extra" /></span>
  </div>
</template>
