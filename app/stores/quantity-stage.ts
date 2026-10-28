import { defineStore } from 'pinia'
import { db } from '~/lib/db/client'
import { createQuantityWorkspaceRecovery } from '~/lib/quantity/command-recovery'
import { createQuantityReadAdapter } from '~/lib/quantity/read-adapter'
import { createQuantityStageState } from '~/lib/quantity/stage-state'

export const useQuantityStageStore = defineStore('quantity-stage', () => {
  const repositories = useNuxtApp().$repositories
  const visibility = useDataVisibilityStore()
  const access = useProductionAccessStore()
  const context = () => repositories.projectCommands.context()
  const reads = createQuantityReadAdapter(repositories.quantity, { db, context, includeDemo: () => visibility.includeDemo })
  return createQuantityStageState({
    read: reads.stages,
    context,
    execute: command => repositories.quantity.execute(command),
    recovery: createQuantityWorkspaceRecovery('stages', () => access.status?.mode === 'production', descriptor => repositories.quantity.resolve(descriptor)),
  })
})
