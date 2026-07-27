<script setup lang="ts">
import type { NavLeaf } from '~/lib/nav/nav-tree'

defineProps<{
  item: NavLeaf
  collapsed?: boolean
}>()
</script>

<template>
  <div
    :title="`${item.label} · ${item.hint} · 待建`"
    data-nav-item
    class="flex cursor-not-allowed select-none items-center rounded-[var(--radius-btn)] text-[var(--shell-sidebar-muted)] opacity-42"
    :class="collapsed
      ? 'mx-auto h-10 w-10 justify-center border border-line bg-surface-2 px-0'
      : 'min-h-[48px] w-full gap-[10px] px-[10px] py-[7px]'"
    aria-disabled="true"
  >
    <span
      data-nav-mark
      class="grid flex-none place-items-center border border-line rounded-[var(--radius-btn)] bg-surface-3 font-800 text-ink-soft"
      :class="collapsed ? 'h-full w-full border-0 bg-transparent text-15px' : 'h-[26px] w-[26px] text-13px'"
      aria-hidden="true"
    >{{ item.mark }}</span>
    <span v-if="!collapsed" class="min-w-0 flex-1 truncate text-13px font-600 text-ink-soft">{{ item.label }}</span>
    <span
      v-if="!collapsed"
      class="flex-none border border-line rounded-[4px] bg-surface-2 px-[5px] py-[1px] text-[10.5px] leading-[1.35] text-ink-soft"
    >待建</span>
  </div>
</template>
