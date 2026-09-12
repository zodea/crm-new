import { defineStore } from 'pinia'
import { db } from '~/lib/db/client'
import { loadQuantityBrowserCatalog } from '~/lib/quantity/browser-catalog'
import { createQuantityBrowserState } from '~/lib/quantity/browser-state'
import { createQuantityRowImporter } from '~/lib/quantity/import-command'
import { createQuantityReadAdapter } from '~/lib/quantity/read-adapter'
import { loadQuantityCatalog } from '~/lib/quantity/read-model'

export const useBrowserQuantityStore = defineStore('quantity-central', () => {
  const repositories = useNuxtApp().$repositories
  const visibility = useDataVisibilityStore()
  const context = () => repositories.projectCommands.context()
  const reads = createQuantityReadAdapter(repositories.quantity, { db, context, includeDemo: () => visibility.includeDemo })
  const state = createQuantityBrowserState({
    reads,
    context,
    includeDemo: () => visibility.includeDemo,
    execute: command => repositories.quantity.execute(command),
    catalog: async () => loadQuantityBrowserCatalog({ list: query => repositories.projectList.list(query), demo: () => loadQuantityCatalog(db) }, { includeDemo: visibility.includeDemo, capabilities: (await context()).capabilities }),
  })
  const importRow = createQuantityRowImporter({ context, quantity: repositories.quantity, projects: query => repositories.projectList.list(query) })
  return { ...state, importRow }
})
