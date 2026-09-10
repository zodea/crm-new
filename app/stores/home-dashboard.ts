import type { HomeProjectReference, HomeProjectScheduleRead } from '~/lib/home/project-source'
import type { ProjectDetailQueryDTO } from '~/lib/project/repository'
import { defineStore } from 'pinia'
import { shallowReadonly, shallowRef } from 'vue'
import { select } from '~/lib/db/connection'
import { createHomeProjectSource } from '~/lib/home/project-source'
import { isDesktopRuntime } from '~/lib/platform/runtime'
import { projectProblemFromUnknown } from '~/lib/project/repository'

export const useHomeDashboardStore = defineStore('home-dashboard', () => {
  const source = createHomeProjectSource({ projects: useNuxtApp().$repositories.projectList, localDb: { select }, desktop: isDesktopRuntime() })
  const catalog = shallowRef<HomeProjectReference[]>([])
  const loading = shallowRef(false)
  let catalogRequest = 0
  let previousIncludeDemo: boolean | undefined

  async function loadCatalog(includeDemo: boolean) {
    const request = ++catalogRequest
    if (previousIncludeDemo !== includeDemo)
      catalog.value = []
    previousIncludeDemo = includeDemo
    loading.value = true
    try {
      const rows = await source.catalog(includeDemo)
      if (request === catalogRequest)
        catalog.value = rows
      return rows
    }
    catch (cause) {
      if (request === catalogRequest && projectProblemFromUnknown(cause).problem.code === 'forbidden')
        catalog.value = []
      throw cause
    }
    finally {
      if (request === catalogRequest)
        loading.value = false
    }
  }

  function readProject(query: ProjectDetailQueryDTO, today: string): Promise<HomeProjectScheduleRead> {
    return source.read(query, today)
  }

  return { catalog: shallowReadonly(catalog), loading: shallowReadonly(loading), loadCatalog, readProject }
})
