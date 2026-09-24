import { useMutationObserver } from '@vueuse/core'
import { validateAuxiliaryReturnTo } from '~/lib/auxiliary-contract/navigation'

export function useOtherSettlementNavigation(root: Ref<HTMLElement | null>) {
  const route = useRoute()
  let pending = true
  const context = (anchor: string) => `${route.fullPath.split('#')[0]}#${anchor}`
  function remember(anchor: string) {
    const key = validateAuxiliaryReturnTo(context(anchor))
    if (key)
      sessionStorage.setItem(`auxiliary-scroll:${key}`, String(document.querySelector('[data-shell-workspace]')?.scrollTop ?? 0))
  }
  async function restore() {
    await nextTick()
    if (!pending || !route.hash || !root.value)
      return
    const element = document.getElementById(route.hash.slice(1))
    if (!element || !root.value.contains(element))
      return
    const saved = sessionStorage.getItem(`auxiliary-scroll:${route.fullPath}`)
    const workspace = document.querySelector('[data-shell-workspace]')
    if (saved !== null && workspace)
      workspace.scrollTop = Number(saved) || 0
    else
      element.scrollIntoView({ block: 'nearest' })
    element.focus({ preventScroll: true })
    pending = false
  }
  useMutationObserver(root, restore, { childList: true, subtree: true })
  watch(() => route.fullPath, () => {
    pending = true
    void restore()
  })
  onActivated(() => {
    pending = true
    void restore()
  })
  return { context, remember, restore }
}
