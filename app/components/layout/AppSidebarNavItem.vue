<script setup lang="ts">
import type { NavLeaf } from '~/lib/nav/nav-tree'

defineProps<{
  item: NavLeaf & { to: string }
  active?: boolean
  collapsed?: boolean
}>()

const emit = defineEmits<{ navigate: [] }>()
</script>

<template>
  <NuxtLink
    :to="item.to"
    :title="`${item.label} · ${item.hint}`"
    class="relative flex h-9 items-center rounded-[var(--radius-btn)] text-left no-underline transition-colors duration-[var(--dur-fast)]"
    :class="[
      collapsed ? 'mx-auto w-10 justify-center px-0' : 'w-full gap-2.5 px-3',
      active
        ? 'bg-[var(--shell-sidebar-active)] text-[var(--shell-sidebar-active-text)] shadow-[var(--ring-selected)]'
        : 'text-[var(--shell-sidebar-muted)] hover:bg-[var(--shell-sidebar-hover)] hover:text-[var(--shell-sidebar-text)]',
    ]"
    @click="emit('navigate')"
  >
    <span
      class="h-4 w-4 flex-none"
      :class="item.icon"
      aria-hidden="true"
    />
    <span v-if="!collapsed" class="min-w-0 flex-1 truncate text-13px font-600">{{ item.label }}</span>
  </NuxtLink>
</template>
