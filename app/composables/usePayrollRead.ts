import type { PayrollContext } from '~/lib/payroll/central-contract'
import { onActivated, onBeforeUnmount, onDeactivated, shallowRef, watch } from 'vue'
import { toErrorMessage } from '~/lib/util/error'

/** 每个只读页面持有自己的读取结果，失效或迟到请求不覆盖另一来源。 */
export function usePayrollRead<T extends { context: Pick<PayrollContext, 'workspaceId' | 'actorId' | 'origin'> }>(target: () => string, reader: () => Promise<T>) {
  const current = shallowRef<T | null>(null)
  const loading = shallowRef(false)
  const error = shallowRef('')
  const active = shallowRef(true)
  let sequence = 0
  let loadedTarget = ''
  async function load() {
    if (!active.value)
      return
    const key = target()
    const request = ++sequence
    if (loadedTarget !== key)
      current.value = null
    loading.value = true
    error.value = ''
    try {
      const result = await reader()
      if (!active.value || request !== sequence || target() !== key)
        return
      current.value = result
      loadedTarget = key
    }
    catch (cause) {
      if (!active.value || request !== sequence || target() !== key)
        return
      current.value = null
      error.value = toErrorMessage(cause)
    }
    finally {
      if (active.value && request === sequence && target() === key)
        loading.value = false
    }
  }
  function suspend() {
    active.value = false
    sequence += 1
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
  onBeforeUnmount(suspend)
  return { current, loading, error, active, load }
}
