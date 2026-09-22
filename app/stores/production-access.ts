import type { ProductionAccessStatus } from '~/lib/customer/access-repository'
import { defineStore } from 'pinia'
import { computed, readonly, shallowRef } from 'vue'

export const useProductionAccessStore = defineStore('production-access', () => {
  const status = shallowRef<ProductionAccessStatus | null>(null)
  const problem = shallowRef('')
  const busy = shallowRef(false)
  const repository = () => useNuxtApp().$repositories.productionAccess
  let generation = 0
  const allowed = computed(() => !problem.value && (status.value?.mode === 'development' || status.value?.authenticated === true))
  function message(cause: unknown) {
    const error = cause as { data?: { message?: unknown }, message?: unknown }
    return typeof error?.data?.message === 'string' ? error.data.message : '本机服务暂不可用，请维护人核对运行配置后重试。'
  }
  async function check() {
    const token = ++generation
    try {
      const current = await repository().status()
      if (token !== generation)
        return
      status.value = current
      problem.value = ''
    }
    catch (cause) {
      if (token !== generation)
        return
      // Transport failure is not confirmed logout: keep drafts mounted but block interaction.
      problem.value = message(cause)
    }
  }
  async function login(code: string) {
    if (busy.value)
      return false
    busy.value = true
    generation++
    problem.value = ''
    try {
      status.value = await repository().login(code)
      return true
    }
    catch (cause) {
      problem.value = message(cause)
      return false
    }
    finally { busy.value = false }
  }
  async function logout() {
    busy.value = true
    generation++
    try {
      await repository().logout()
      status.value = null
      return true
    }
    catch (cause) {
      problem.value = message(cause)
      return false
    }
    finally { busy.value = false }
  }
  return { status: readonly(status), problem: readonly(problem), busy: readonly(busy), allowed, check, login, logout }
})
