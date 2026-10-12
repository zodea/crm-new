import { defineStore } from 'pinia'
import { createProcessLibraryState } from '~/lib/schedule/process-library-state'
import { useDataVisibilityStore } from '~/stores/data-visibility'

export const useScheduleProcessLibraryStore = defineStore('central-process-library', () => {
  const visibility = useDataVisibilityStore()
  return createProcessLibraryState(useNuxtApp().$repositories.processLibraries, () => visibility.includeDemo ? 'demo' : 'real')
})
