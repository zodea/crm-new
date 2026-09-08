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
    :aria-label="item.label"
    data-nav-item
    class="relative flex items-center rounded-[2px] text-left no-underline outline-none transition-[background-color,color,box-shadow] duration-[var(--dur-fast)] focus-visible:[box-shadow:inset_0_0_0_2px_var(--brand)]"
    :class="[
      collapsed
        ? 'mx-auto h-9 w-9 justify-center px-0'
        : 'h-[32px] w-full gap-[8px] px-[10px]',
      active
        ? 'bg-[var(--shell-sidebar-active)] text-[var(--shell-sidebar-active-text)] shadow-[inset_2px_0_0_var(--brand)]'
        : 'text-[var(--shell-sidebar-muted)] hover:bg-[var(--shell-sidebar-hover)] hover:text-[var(--shell-sidebar-text)]',
    ]"
    @click="emit('navigate')"
  >
    <span
      data-nav-mark
      class="h-[14px] w-[14px] flex-none"
      :class="item.icon"
      aria-hidden="true"
    />
    <span v-if="!collapsed" class="min-w-0 flex-1 truncate text-12px leading-[1.3]" :class="active ? 'font-600' : 'font-400'">{{ item.label }}</span>
  </NuxtLink>
</template>
