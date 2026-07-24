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
    class="relative flex items-center rounded-[var(--radius-btn)] text-left no-underline outline-none transition-[background-color,color,box-shadow] duration-[var(--dur-fast)] focus-visible:[box-shadow:inset_0_0_0_2px_var(--brand)]"
    :class="[
      collapsed
        ? 'mx-auto h-10 w-10 justify-center border px-0 text-15px font-800'
        : 'min-h-[52px] w-full gap-[12px] px-[12px] py-[10px]',
      active
        ? collapsed
          ? 'border-[rgb(57_118_198/25%)] bg-[var(--shell-sidebar-active)] text-[var(--brand)]'
          : 'bg-[var(--shell-sidebar-active)] text-[var(--brand)] shadow-[var(--ring-selected)]'
        : collapsed
          ? 'border-[var(--shell-sidebar-border)] bg-[var(--surface-2)] text-[var(--shell-sidebar-muted)] hover:bg-[var(--shell-sidebar-hover)] hover:text-[var(--shell-sidebar-text)]'
          : 'text-[var(--shell-sidebar-muted)] hover:bg-[var(--shell-sidebar-hover)] hover:text-[var(--shell-sidebar-text)]',
    ]"
    @click="emit('navigate')"
  >
    <span
      data-nav-mark
      class="grid flex-none place-items-center font-800"
      :class="collapsed
        ? 'h-full w-full rounded-[var(--radius-btn)] text-15px'
        : [
          'h-8 w-8 border rounded-[var(--radius-btn)] text-14px',
          active
            ? 'border-[rgb(57_118_198/25%)] bg-panel text-brand'
            : 'border-line bg-surface-2 text-ink-soft',
        ]"
      aria-hidden="true"
    >{{ item.mark }}</span>
    <span v-if="!collapsed" class="min-w-0 flex-1">
      <span
        class="block truncate text-13px font-800 leading-[1.2]"
        :class="active ? 'text-brand' : 'text-ink'"
      >{{ item.label }}</span>
      <span class="mt-[1px] block truncate text-11px leading-[1.35] text-ink-soft opacity-75">{{ item.hint }}</span>
    </span>
  </NuxtLink>
</template>
