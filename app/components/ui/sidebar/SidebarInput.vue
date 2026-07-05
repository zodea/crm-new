<script setup lang="ts">
// 移植自官方 registry new-york/ui/sidebar/SidebarInput.vue。
// 差异：Input 组件内联为原生 input（ADR 0008 不引整套 input），v-model 直通。
import type { HTMLAttributes } from 'vue'
import { cn } from '~/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()

const model = defineModel<string>()
</script>

<template>
  <input
    v-model="model"
    data-sidebar="input"
    :class="cn(
      'h-8 w-full rounded-md border border-input bg-background px-2 text-13px outline-none shadow-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
      props.class,
    )"
  >
</template>
