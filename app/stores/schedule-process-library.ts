import { isTauri } from '@tauri-apps/api/core'
import { defineStore } from 'pinia'
import { createProcessLibraryState } from '~/lib/schedule/process-library-state'
import { useDataVisibilityStore } from '~/stores/data-visibility'
import { useNativeScheduleProcessLibraryStore } from '~/stores/schedule-process-library-native'

const useCentralProcessLibraryStore = defineStore('central-process-library', () => {
  const visibility = useDataVisibilityStore()
  return createProcessLibraryState(useNuxtApp().$repositories.processLibraries, () => visibility.includeDemo ? 'demo' : 'real')
})

export function useScheduleProcessLibraryStore() {
  return isTauri() ? useNativeScheduleProcessLibraryStore() : useCentralProcessLibraryStore()
}
