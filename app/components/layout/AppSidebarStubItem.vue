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
    class="flex h-9 cursor-not-allowed select-none items-center rounded-[var(--radius-btn)] text-[var(--shell-sidebar-muted)] opacity-45"
    :class="collapsed ? 'mx-auto w-10 justify-center px-0' : 'w-full gap-2.5 px-3'"
    aria-disabled="true"
  >
    <span
      class="h-4 w-4 flex-none"
      :class="item.icon"
      aria-hidden="true"
    />
    <span v-if="!collapsed" class="min-w-0 flex-1 truncate text-13px font-500">{{ item.label }}</span>
  </div>
</template>
