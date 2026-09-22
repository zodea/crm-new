import type { QuantityUnitReadQuery } from '~/lib/quantity/central-contract'
import type { QuantityHollowRead } from '~/lib/quantity/central-hollow-contract'
import { onActivated, onDeactivated, onScopeDispose, shallowRef, watch } from 'vue'
import { toErrorMessage } from '~/lib/util/error'
import { useQuantityHollowStore } from '~/stores/quantity-hollow'

/** 视图独占读取；取消只影响读取，不影响该户持久的原命令。 */
export function useQuantityHollowRead(query: () => QuantityUnitReadQuery | null, detailKey: () => string = () => '') {
  const store = useQuantityHollowStore()
  const current = shallowRef<QuantityHollowRead | null>(null)
  const loading = shallowRef(false)
  const error = shallowRef('')
  const active = shallowRef(true)
  let generation = 0
  let controller: AbortController | null = null
  const target = () => JSON.stringify([query(), detailKey()])
  async function load() {
    if (!active.value)
      return null
    const request = ++generation
    const key = target()
    controller?.abort()
    controller = new AbortController()
    current.value = null
    loading.value = true
    error.value = ''
    try {
      const scope = query()
      if (!scope)
        throw new Error('原户、项目或数据来源无效，请从工程量重新进入。')
      const read = await store.load(scope, { signal: controller.signal })
      if (!active.value || request !== generation || key !== target())
        return null
      current.value = read
      return read
    }
    catch (cause) {
      if (active.value && request === generation && key === target())
        error.value = toErrorMessage(cause)
      return null
    }
    finally {
      if (request === generation)
        loading.value = false
    }
  }
  function suspend() {
    active.value = false
    generation += 1
    controller?.abort()
    loading.value = false
  }
  watch(target, () => void load(), { immediate: true })
  onActivated(() => {
    if (!active.value) {
      active.value = true
      void load()
    }
  })
  onDeactivated(suspend)
  onScopeDispose(suspend)
  return { current, loading, error, active, load }
}
