import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'
import {
  consumeDataVisibilitySwitch,
  DATA_VISIBILITY_STORAGE_KEY,
  requestDemoWorkspaceAuthorization,
} from '~/lib/data-visibility'

export { DATA_VISIBILITY_STORAGE_KEY } from '~/lib/data-visibility'

export const useDataVisibilityStore = defineStore('data-visibility', () => {
  const preference = useLocalStorage(DATA_VISIBILITY_STORAGE_KEY, false)
  const authorized = shallowRef(false)
  const initialized = shallowRef(false)
  const includeDemo = computed(() => initialized.value && authorized.value && preference.value)

  async function initialize(
    authorize: () => Promise<boolean> = requestDemoWorkspaceAuthorization,
  ) {
    const pending = consumeDataVisibilitySwitch(
      typeof sessionStorage === 'undefined' ? null : sessionStorage,
    )
    const requested = pending ?? preference.value
    if (!requested) {
      authorized.value = false
      preference.value = false
      initialized.value = true
      return
    }

    authorized.value = await authorize()
    preference.value = authorized.value
    initialized.value = true
  }

  async function authorizeDemo(
    authorize: () => Promise<boolean> = requestDemoWorkspaceAuthorization,
  ): Promise<boolean> {
    authorized.value = await authorize()
    return authorized.value
  }

  function reset() {
    authorized.value = false
    initialized.value = true
    preference.value = false
  }

  return {
    includeDemo,
    initialized,
    initialize,
    authorizeDemo,
    reset,
  }
})
