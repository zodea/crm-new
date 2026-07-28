<script setup lang="ts">
// 区块标题（KitAtoms §3.2）：4×16 品牌竖条 + 标题 + 右侧扩展槽。
// 基准：DC重构设计源码/kit/KitAtoms.jsx SectionHeader。
// 标题走默认插槽，右侧操作/说明走 #extra 插槽。
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
    class="min-h-8 flex items-center gap-2 border-y border-line bg-surface-2 px-3"
    :style="{ marginBottom: `${mb}px` }"
  >
    <span aria-hidden="true" class="h-3.5 w-[3px] flex-none rounded-[1px] bg-brand" />
    <span class="shrink-0 text-[13px] font-700 text-ink"><slot>{{ title }}</slot></span>
    <span v-if="subtitle" class="min-w-0 truncate text-[11px] text-ink-faint" :title="subtitle">{{ subtitle }}</span>
    <span v-if="$slots.extra" class="ml-auto"><slot name="extra" /></span>
  </div>
</template>
