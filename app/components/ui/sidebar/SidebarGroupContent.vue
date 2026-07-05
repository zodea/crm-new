<script setup lang="ts">
// 移植自官方 registry new-york/ui/sidebar/SidebarGroupContent.vue（照抄；text-sm→text-13px 对齐项目字号）。
import type { HTMLAttributes } from 'vue'
import { cn } from '~/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-sidebar="group-content"
    :class="cn('w-full text-13px', props.class)"
  >
    <slot />
  </div>
</template>
