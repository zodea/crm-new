// shadcn-vue Sidebar（ADR 0008）—— 移植自官方 registry new-york/ui/sidebar/utils.ts。
// 差异：宽度常量接项目布局令牌（--sidebar-w 248px / --sidebar-w-collapsed 68px），其余照抄。
import type { ComputedRef, Ref } from 'vue'
import { createContext } from 'reka-ui'

export const SIDEBAR_COOKIE_NAME = 'sidebar_state'
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
export const SIDEBAR_WIDTH = 'var(--sidebar-w)'
export const SIDEBAR_WIDTH_MOBILE = 'var(--sidebar-w)'
export const SIDEBAR_WIDTH_ICON = 'var(--sidebar-w-collapsed)'
export const SIDEBAR_KEYBOARD_SHORTCUT = 'b'

export const [useSidebar, provideSidebarContext] = createContext<{
  state: ComputedRef<'expanded' | 'collapsed'>
  open: Ref<boolean>
  setOpen: (value: boolean) => void
  isMobile: Ref<boolean>
  openMobile: Ref<boolean>
  setOpenMobile: (value: boolean) => void
  toggleSidebar: () => void
}>('Sidebar')
