import type { DataOriginDTO } from '~/types/read-model'
import { nextTick } from 'vue'
import { resolveCustomerProjectReturnOrigin } from '~/lib/customer/return-context'

/** 只恢复当前客户关系区的视图状态；数据仍由中央读模型重载。 */
export function useCustomerProjectReturnContext(options: {
  customerId: () => string
  origin: () => DataOriginDTO
}) {
  const route = useRoute()
  return async function restore() {
    if (route.path !== `/base/customer/${encodeURIComponent(options.customerId())}`)
      return false
    const context = resolveCustomerProjectReturnOrigin(route.fullPath, { origin: options.origin() })
    if (!context)
      return false
    await nextTick()
    const region = document.querySelector<HTMLElement>('[data-customer-relations]')
    const link = [...(region?.querySelectorAll<HTMLElement>('[data-customer-project-id]') ?? [])]
      .find(element => element.dataset.customerProjectId === context.projectId
        && element.dataset.customerRelationAnchor === context.anchorId && element.getClientRects().length > 0)
    const workspace = document.querySelector<HTMLElement>('[data-shell-workspace]')
    if (workspace)
      workspace.scrollTop = context.scrollTop
    ;(link ?? region)?.focus({ preventScroll: true })
    return true
  }
}
