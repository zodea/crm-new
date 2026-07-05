<script setup lang="ts">
// 移植自官方 registry new-york/ui/sidebar/SidebarGroupLabel.vue。
// 差异：text-sidebar-foreground/70 → text-ink-faint（透明度修饰对 var() 色不生效）。
import type { PrimitiveProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { Primitive } from 'reka-ui'
import { cn } from '~/lib/utils'

const props = defineProps<PrimitiveProps & {
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <Primitive
    data-sidebar="group-label"
    :as="as"
    :as-child="asChild"
    :class="cn(
      'duration-200 flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-500 text-ink-faint outline-none ring-sidebar-ring transition-[margin,opacity] ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0',
      'group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0',
      props.class)"
  >
    <slot />
  </Primitive>
</template>
