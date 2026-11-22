// shadcn-vue Sidebar（ADR 0008）—— 移植自官方 registry new-york/ui/sidebar/index.ts。
import type { HTMLAttributes } from 'vue'

export interface SidebarProps {
  side?: 'left' | 'right'
  variant?: 'sidebar' | 'floating' | 'inset'
  collapsible?: 'offcanvas' | 'icon' | 'none'
  /** icon 折叠态保持内容占位 68px，但面板临时覆盖展开到 248px。 */
  peekOpen?: boolean
  class?: HTMLAttributes['class']
}

export { default as Sidebar } from './Sidebar.vue'
export { default as SidebarContent } from './SidebarContent.vue'
export { default as SidebarFooter } from './SidebarFooter.vue'
export { default as SidebarHeader } from './SidebarHeader.vue'
export { default as SidebarInset } from './SidebarInset.vue'
export { default as SidebarProvider } from './SidebarProvider.vue'
export { default as SidebarTrigger } from './SidebarTrigger.vue'

export { useSidebar } from './utils'
