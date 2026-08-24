import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { resolveProjectSupplierReturnContext } from '~/lib/project-supplier/return-context'

export function useProjectSupplierReturnContext(
  actualProjectId: MaybeRefOrGetter<unknown>,
  actualSupplierId: MaybeRefOrGetter<unknown>,
) {
  const route = useRoute()
  return computed(() => resolveProjectSupplierReturnContext({
    returnTo: route.query?.returnTo,
    projectId: route.query?.projectId,
    supplierId: route.query?.supplierId,
    actualProjectId: toValue(actualProjectId),
    actualSupplierId: toValue(actualSupplierId),
  }))
}
