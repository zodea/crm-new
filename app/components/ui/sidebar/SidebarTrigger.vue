<script setup lang="ts">
// 移植自官方 registry new-york/ui/sidebar/SidebarTrigger.vue。
// 差异：图标用 UnoCSS i-lucide-panel-left（项目图标体系），Button 用项目 ui/button。
import type { HTMLAttributes } from 'vue'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { useSidebar } from './utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()

const { toggleSidebar } = useSidebar()
</script>

<template>
  <Button
    data-sidebar="trigger"
    variant="ghost"
    size="icon"
    :class="cn('h-7 w-7', props.class)"
    @click="toggleSidebar"
  >
    <span class="i-lucide-panel-left h-[15px] w-[15px]" aria-hidden="true" />
    <span class="sr-only">切换侧边栏</span>
  </Button>
</template>
