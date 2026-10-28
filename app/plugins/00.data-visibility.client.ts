export default defineNuxtPlugin({ name: 'data-visibility', async setup() {
  const store = useDataVisibilityStore()

  await store.initialize()
} })
