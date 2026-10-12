import { defineStore } from 'pinia'
import { createProcessLibraryState } from '~/lib/schedule/process-library-state'
import { useDataVisibilityStore } from '~/stores/data-visibility'

const useCentralProcessLibraryStore = defineStore('central-process-library', () => {
  const visibility = useDataVisibilityStore()
  return createProcessLibraryState(useNuxtApp().$repositories.processLibraries, () => visibility.includeDemo ? 'demo' : 'real')
})

export function useScheduleProcessLibraryStore() {
  return useCentralProcessLibraryStore()
}
