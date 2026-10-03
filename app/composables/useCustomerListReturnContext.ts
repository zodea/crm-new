import type { CustomerListNavigationState } from '~/lib/customer/return-context'
import {
  createCustomerReturnOrigin,
  customerListNavigationStateFromQuery,
  loadCustomerReturnOrigin,
  newCustomerReturnContextId,
  resolveCustomerReturnContext,
  saveCustomerReturnOrigin,
} from '~/lib/customer/return-context'

export function useCustomerListReturnContext(options: {
  readState: () => CustomerListNavigationState
  applyState: (state: CustomerListNavigationState) => void
  root: () => HTMLElement | null
  isReady: () => boolean
  fallbackFocus?: () => HTMLElement | null
}) {
  const route = useRoute()
  const routeNav = typeof route.query.nav === 'string' ? route.query.nav : ''
  const contextId = /^[\w-]{8,64}$/.test(routeNav) ? routeNav : newCustomerReturnContextId()
  let restored = ''
  const anchorId = (identity: string) => `customer-row-${encodeURIComponent(identity)}`
  const origin = (identity: string, scrollTop: number) => createCustomerReturnOrigin({
    contextId,
    anchorId: anchorId(identity),
    scrollTop,
    now: Date.now(),
    state: options.readState(),
  })

  function capture(identity: string) {
    const workspace = document.querySelector<HTMLElement>('[data-shell-workspace]')
    saveCustomerReturnOrigin(origin(identity, workspace?.scrollTop ?? 0))
  }

  async function restore() {
    if (route.path !== '/base/customer' || restored === route.fullPath || !options.isReady())
      return false
    const resolved = resolveCustomerReturnContext({
      returnTo: route.fullPath,
      contextId: route.query.nav,
      now: Date.now(),
      load: loadCustomerReturnOrigin,
    })
    const savedOrigin = resolved.origin
    if (!savedOrigin)
      return false
    const fullPath = route.fullPath
    await nextTick()
    if (route.fullPath !== fullPath || !options.isReady())
      return false
    const root = options.root()
    if (!root?.isConnected)
      return false
    const anchor = [...root.querySelectorAll<HTMLElement>('[id]')].find(element => element.id === savedOrigin.anchorId)
    const target = anchor?.querySelector<HTMLElement>('a, button, [tabindex]')
      ?? options.fallbackFocus?.()
    if (!target)
      return false
    const workspace = document.querySelector<HTMLElement>('[data-shell-workspace]')
    if (workspace)
      workspace.scrollTop = savedOrigin.scrollTop
    target.focus({ preventScroll: true })
    restored = fullPath
    return true
  }

  if (route.path === '/base/customer')
    options.applyState(customerListNavigationStateFromQuery(route.query))
  onActivated(() => void restore())
  return {
    contextId,
    anchorId,
    returnToFor: (identity: string) => origin(identity, 0).returnTo,
    capture,
    restore,
  }
}
