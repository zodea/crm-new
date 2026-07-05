<script setup lang="ts">
// 移植自官方 registry new-york/ui/sidebar/SidebarSeparator.vue。
// 差异：Separator 用 reka-ui 原语（ADR 0008 不引整套 separator）。
import type { HTMLAttributes } from 'vue'
import { Separator } from 'reka-ui'
import { cn } from '~/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <Separator
    data-sidebar="separator"
    :class="cn('mx-2 h-px w-auto bg-sidebar-border', props.class)"
  />
</template>
