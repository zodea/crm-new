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
    class="flex cursor-not-allowed select-none items-center rounded-[var(--radius-btn)] text-[var(--shell-sidebar-muted)]"
    :class="collapsed
      ? 'mx-auto h-9 w-9 justify-center px-0'
      : 'h-[38px] w-full gap-[8px] px-[10px]'"
    aria-disabled="true"
  >
    <span
      data-nav-mark
      class="h-[18px] w-[18px] flex-none"
      :class="item.icon"
      aria-hidden="true"
    />
    <span v-if="!collapsed" class="min-w-0 flex-1 truncate text-14px leading-5">{{ item.label }}</span>
    <span
      v-if="!collapsed"
      class="flex-none rounded-[2px] bg-[var(--shell-sidebar-input)] px-1 text-11px leading-[1.4]"
    >待建</span>
  </div>
</template>
