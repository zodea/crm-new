<script setup lang="ts">
// pill 搜索框（KitAtoms）：左置放大镜图标 + 圆角胶囊输入，即输即筛。
// 基准：DC重构设计源码/kit/KitAtoms.jsx SearchInput。
withDefaults(defineProps<{
  placeholder?: string
  width?: number
}>(), { placeholder: '搜索…', width: 210 })

const model = defineModel<string>()
</script>

<template>
  <div class="relative">
    <span class="absolute left-[12px] top-1/2 flex -translate-y-1/2">
      <span class="i-lucide-search text-[14px] text-ink-faint" />
    </span>
    <input
      v-model="model"
      :placeholder="placeholder"
      class="border border-line-strong rounded-full bg-white pl-[32px] pr-[14px] py-[8px] text-[13px] outline-none focus:border-brand"
      :style="{ width: `${width}px` }"
    >
  </div>
</template>
