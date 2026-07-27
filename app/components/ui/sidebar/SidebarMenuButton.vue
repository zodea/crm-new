<script setup lang="ts">
// 移植自官方 registry new-york/ui/sidebar/SidebarMenuButton.vue。
// 差异：Tooltip 用 reka-ui 原语内联（ADR 0008 不引整套 tooltip 组件目录），
// TooltipProvider 已由 SidebarProvider 提供；浮层样式接 --shadow-pop / bg-panel。
import type { Component } from 'vue'
import type { SidebarMenuButtonProps } from './SidebarMenuButtonChild.vue'
import { reactiveOmit } from '@vueuse/core'
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui'
import { useOwnedOverlayLayerStyle } from '~/composables/useOverlayStack'
import SidebarMenuButtonChild from './SidebarMenuButtonChild.vue'
import { useSidebar } from './utils'

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<SidebarMenuButtonProps & {
  tooltip?: string | Component
}>(), {
  as: 'button',
  variant: 'default',
  size: 'default',
})

const { isMobile, state } = useSidebar()

const delegatedProps = reactiveOmit(props, 'tooltip')
const ownedLayerStyle = useOwnedOverlayLayerStyle()
</script>

<template>
  <SidebarMenuButtonChild v-if="!tooltip" v-bind="{ ...delegatedProps, ...$attrs }">
    <slot />
  </SidebarMenuButtonChild>

  <TooltipRoot v-else>
    <TooltipTrigger as-child>
      <SidebarMenuButtonChild v-bind="{ ...delegatedProps, ...$attrs }">
        <slot />
      </SidebarMenuButtonChild>
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent
        v-if="state === 'collapsed' && !isMobile"
        side="right"
        align="center"
        :side-offset="6"
        data-overlay-owned
        class="overlay-layer-owned rounded-[var(--radius-sm)] border border-line bg-panel px-2.5 py-1.5 text-12px text-ink shadow-[var(--shadow-pop)] data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95"
        :style="ownedLayerStyle"
      >
        <template v-if="typeof tooltip === 'string'">
          {{ tooltip }}
        </template>
        <component :is="tooltip" v-else />
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
