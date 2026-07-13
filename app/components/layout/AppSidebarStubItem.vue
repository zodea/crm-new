<script setup lang="ts">
// 侧栏「待建」占位项 —— 对齐设计稿 stubItem：灰显 + 徽标 + 不可点。
// 对应 #87 roadmap 后续域 / #91 批C-E 未实装页面，页面落地后换成 AppSidebarNavItem。
defineProps<{
  mark: string
  label: string
}>()
</script>

<template>
  <div
    :title="`${label} · 后续批次实装`"
    class="flex select-none items-center gap-[10px] rounded-[var(--radius-btn)] px-[10px] py-[7px] opacity-42 cursor-not-allowed"
  >
    <span
      class="grid h-[26px] w-[26px] flex-none place-items-center border border-line rounded-[7px] bg-surface-3 text-13px font-800 text-ink-soft"
      aria-hidden="true"
    >{{ mark }}</span>
    <span class="flex-1 truncate text-13px font-600 text-ink-soft">{{ label }}</span>
    <span class="flex-none border border-line rounded-[4px] bg-surface-2 px-[5px] py-[1px] text-10.5px">待建</span>
  </div>
</template>
