<script setup lang="ts">
// 侧栏导航项 —— 对齐设计稿 NavItem（品牌签名：中文单字方块 + 名称 + 副提示）。
// 选中态：浅蓝底 + 蓝字 + 左侧 3px 内描边蓝条（--ring-selected）；方块翻白底蓝字。
defineProps<{
  mark: string
  label: string
  hint?: string
  to: string
  active?: boolean
}>()

const emit = defineEmits<{ navigate: [] }>()
</script>

<template>
  <NuxtLink
    :to="to"
    class="flex w-full items-center gap-[12px] rounded-[var(--radius-btn)] px-[12px] py-[10px] text-left transition-colors duration-[var(--dur-fast)]"
    :class="active ? 'bg-brand-soft text-brand shadow-[var(--ring-selected)]' : 'text-ink-soft hover:bg-surface-3'"
    @click="emit('navigate')"
  >
    <span
      class="grid h-[32px] w-[32px] flex-none place-items-center border rounded-[var(--radius-btn)] text-14px font-800"
      :class="active
        ? 'bg-white border-[rgba(57,118,198,0.25)] text-brand'
        : 'bg-surface-2 border-line text-ink-soft'"
      aria-hidden="true"
    >{{ mark }}</span>
    <span class="min-w-0">
      <span
        class="block text-13px font-800 leading-tight"
        :class="active ? 'text-brand' : 'text-ink'"
      >{{ label }}</span>
      <span v-if="hint" class="block truncate text-11px leading-snug opacity-75">{{ hint }}</span>
    </span>
  </NuxtLink>
</template>
