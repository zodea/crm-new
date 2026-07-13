<script setup lang="ts">
// 移植自官方 registry new-york/ui/sidebar/SidebarGroupContent.vue（字号对齐项目 14px 导航基准）。
import type { HTMLAttributes } from 'vue'
import { cn } from '~/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-sidebar="group-content"
    :class="cn('w-full text-14px', props.class)"
  >
    <slot />
  </div>
</template>
