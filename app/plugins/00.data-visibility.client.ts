import { isTauri } from '@tauri-apps/api/core'

export default defineNuxtPlugin(async () => {
  const store = useDataVisibilityStore()
  if (isTauri()) {
    store.reset()
    return
  }
  await store.initialize()
})
