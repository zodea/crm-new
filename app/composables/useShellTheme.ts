import type { InjectionKey, Ref } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { inject, provide, readonly } from 'vue'

export type ShellTheme = 'dark' | 'light'

interface ShellThemeContext {
  theme: Readonly<Ref<ShellTheme>>
  toggleTheme: () => void
}

const shellThemeKey: InjectionKey<ShellThemeContext> = Symbol('shell-theme')

/** 外壳主题只影响导航与顶栏，不改变业务卡片和状态语义色。 */
export function provideShellTheme(): ShellThemeContext {
  const theme = useLocalStorage<ShellTheme>('ruihang-shell-theme', 'dark', {
    initOnMounted: true,
  })

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }

  const context: ShellThemeContext = {
    theme: readonly(theme),
    toggleTheme,
  }
  provide(shellThemeKey, context)
  return context
}

export function useShellTheme(): ShellThemeContext {
  const context = inject(shellThemeKey)
  if (!context)
    throw new Error('useShellTheme must be used inside provideShellTheme')
  return context
}
