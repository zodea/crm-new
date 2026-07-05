<script setup lang="ts">
// 移植自官方 registry new-york/ui/sidebar/SidebarMenuSkeleton.vue。
// 差异：Skeleton 组件内联为 animate-pulse div（ADR 0008 不引整套 skeleton）。
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { cn } from '~/lib/utils'

const props = defineProps<{
  showIcon?: boolean
  class?: HTMLAttributes['class']
}>()

const width = computed(() => `${Math.floor(Math.random() * 40) + 50}%`)
</script>

<template>
  <div
    data-sidebar="menu-skeleton"
    :class="cn('rounded-md h-8 flex gap-2 px-2 items-center', props.class)"
  >
    <div
      v-if="showIcon"
      class="size-4 animate-pulse rounded-md bg-muted"
      data-sidebar="menu-skeleton-icon"
    />
    <div
      class="h-4 max-w-[var(--skeleton-width)] flex-1 animate-pulse rounded-md bg-muted"
      data-sidebar="menu-skeleton-text"
      :style="{ '--skeleton-width': width }"
    />
  </div>
</template>
