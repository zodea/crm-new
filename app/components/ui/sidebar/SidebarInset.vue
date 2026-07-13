<script setup lang="ts">
// 移植自官方 registry new-york/ui/sidebar/SidebarInset.vue。
// 差异：theme(spacing.4) → 1rem；rounded-xl → rounded-[var(--radius-card)]（ADR 0007 卡片圆角）。
import type { HTMLAttributes } from 'vue'
import { cn } from '~/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <main
    :class="cn(
      'relative flex min-h-svh flex-1 flex-col bg-background',
      'peer-data-[variant=inset]:min-h-[calc(100svh-1rem)] lg:peer-data-[variant=inset]:m-2 lg:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-2 lg:peer-data-[variant=inset]:ml-0 lg:peer-data-[variant=inset]:rounded-[var(--radius-card)] lg:peer-data-[variant=inset]:shadow lg:peer-data-[variant=inset]:border lg:peer-data-[variant=inset]:border-line',
      props.class,
    )"
  >
    <slot />
  </main>
</template>
