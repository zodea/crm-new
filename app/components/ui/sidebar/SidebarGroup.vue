<script setup lang="ts">
// 移植自官方 registry new-york/ui/sidebar/SidebarGroup.vue（照抄）。
import type { HTMLAttributes } from 'vue'
import { cn } from '~/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-sidebar="group"
    :class="cn('relative flex w-full min-w-0 flex-col p-2', props.class)"
  >
    <slot />
  </div>
</template>
