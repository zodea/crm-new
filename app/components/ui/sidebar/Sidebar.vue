<script setup lang="ts">
// 移植自官方 registry new-york/ui/sidebar/Sidebar.vue（gap+fixed 双层结构逐行对照）。
// 差异：①移动端用 reka-ui Dialog 内联实现 Sheet（ADR 0008 不引整套 sheet）；
// ②sidebar 内层加 backdrop-blur（配 --sidebar-background 82% 白，保留毛玻璃特色）；
// ③theme(spacing.4) → 1rem；w-(--x) → w-[var(--x)]（UnoCSS 语法）。
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { SidebarProps } from '.'
import { cn } from '~/lib/utils'
import { SIDEBAR_WIDTH_MOBILE, useSidebar } from './utils'

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<SidebarProps>(), {
  side: 'left',
  variant: 'sidebar',
  collapsible: 'offcanvas',
})

const { isMobile, state, openMobile, setOpenMobile } = useSidebar()
</script>

<template>
  <div
    v-if="collapsible === 'none'"
    :class="cn('flex h-full w-[var(--sidebar-width)] flex-col bg-sidebar text-sidebar-foreground backdrop-blur-[12px]', props.class)"
    v-bind="$attrs"
  >
    <slot />
  </div>

  <!-- 移动端：reka Dialog 内联 Sheet（侧滑抽屉） -->
  <DialogRoot v-else-if="isMobile" :open="openMobile" v-bind="$attrs" @update:open="setOpenMobile">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-[9600] bg-[var(--overlay)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
      />
      <DialogContent
        data-sidebar="sidebar"
        data-mobile="true"
        :class="cn(
          'fixed inset-y-0 z-[9601] flex h-svh w-[var(--sidebar-width)] flex-col bg-sidebar p-0 text-sidebar-foreground outline-none backdrop-blur-[12px] data-[state=open]:animate-in data-[state=closed]:animate-out',
          side === 'right'
            ? 'right-0 border-l border-sidebar-border data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right'
            : 'left-0 border-r border-sidebar-border data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
        )"
        :style="{ '--sidebar-width': SIDEBAR_WIDTH_MOBILE }"
      >
        <DialogTitle class="sr-only">
          导航菜单
        </DialogTitle>
        <DialogDescription class="sr-only">
          移动端侧边栏
        </DialogDescription>
        <div class="flex h-full w-full flex-col">
          <slot />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <div
    v-else
    class="group peer hidden md:block"
    :data-state="state"
    :data-collapsible="state === 'collapsed' ? collapsible : ''"
    :data-variant="variant"
    :data-side="side"
  >
    <!-- gap：撑开内容区（桌面），宽度随 state 过渡 -->
    <div
      :class="cn(
        'duration-200 relative h-svh w-[var(--sidebar-width)] bg-transparent transition-[width] ease-linear',
        'group-data-[collapsible=offcanvas]:w-0',
        'group-data-[side=right]:rotate-180',
        variant === 'floating' || variant === 'inset'
          ? 'group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_1rem)]'
          : 'group-data-[collapsible=icon]:w-[var(--sidebar-width-icon)]',
      )"
    />
    <div
      :class="cn(
        'duration-200 fixed inset-y-0 z-10 hidden h-svh w-[var(--sidebar-width)] transition-[left,right,width] ease-linear md:flex',
        side === 'left'
          ? 'left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]'
          : 'right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]',
        variant === 'floating' || variant === 'inset'
          ? 'p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_1rem_+_2px)]'
          : 'group-data-[collapsible=icon]:w-[var(--sidebar-width-icon)] group-data-[side=left]:border-r group-data-[side=right]:border-l',
        props.class,
      )"
      v-bind="$attrs"
    >
      <div
        data-sidebar="sidebar"
        class="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground backdrop-blur-[12px] group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow group-data-[variant=inset]:rounded-[var(--radius-card)] group-data-[variant=inset]:border group-data-[variant=inset]:border-sidebar-border group-data-[variant=inset]:shadow-[var(--sidebar-shadow)]"
      >
        <slot />
      </div>
    </div>
  </div>
</template>
