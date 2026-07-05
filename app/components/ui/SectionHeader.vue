<script setup lang="ts">
// 区块标题（KitAtoms §3.2）：4×16 品牌竖条 + 标题 + 右侧扩展槽。
// 基准：DC重构设计源码/kit/KitAtoms.jsx SectionHeader。
// 标题走默认插槽，右侧操作/说明走 #extra 插槽。
withDefaults(defineProps<{
  mb?: number
}>(), { mb: 12 })
</script>

<template>
  <div class="flex items-center gap-[10px]" :style="{ marginBottom: `${mb}px` }">
    <span class="h-[16px] w-[4px] flex-none rounded-[2px] bg-brand" />
    <span class="text-[15px] font-800 text-ink"><slot /></span>
    <span v-if="$slots.extra" class="ml-auto"><slot name="extra" /></span>
  </div>
</template>
