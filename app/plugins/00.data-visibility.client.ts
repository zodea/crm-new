import { isTauri } from '@tauri-apps/api/core'

export default defineNuxtPlugin({ name: 'data-visibility', async setup() {
  const store = useDataVisibilityStore()
  if (isTauri()) {
    store.reset()
    return
  }
  await store.initialize()
} })
