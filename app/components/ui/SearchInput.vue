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
    <span aria-hidden="true" class="absolute left-[12px] top-1/2 flex -translate-y-1/2">
      <span class="i-lucide-search h-[14px] w-[14px] text-ink-faint" />
    </span>
    <input
      v-model="model"
      type="search"
      :placeholder="placeholder"
      :aria-label="placeholder"
      class="h-8 border border-line-strong rounded-[var(--radius-btn)] bg-panel pl-[32px] pr-[14px] text-[13px] text-ink outline-none placeholder:text-ink-faint focus-visible:border-brand focus-visible:shadow-[0_0_0_3px_var(--brand-ring)]"
      :style="{ width: `${width}px` }"
    >
  </div>
</template>
