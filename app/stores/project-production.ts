import type { ProjectLifecycleRead } from '~/lib/project/production-contract'
import { defineStore } from 'pinia'
import { clearProjectPending, projectPendingKey, readProjectPending, rememberProjectPending } from '~/lib/project/pending'
import { useProjectCommandStore } from '~/stores/project-command'

export const useProjectProductionStore = defineStore('project-production', () => {
  const repositories = () => useNuxtApp().$repositories
  async function recover(id: string) {
    const context = await repositories().projectCommands.context()
    const key = projectPendingKey(context, `lifecycle:${id}`)
    const commandId = readProjectPending(key)
    if (!commandId)
      return null
    const resolved = await repositories().projectProduction.resolve(commandId)
    const current = await repositories().projectProduction.lifecycle(id)
    clearProjectPending(key, commandId)
    if (resolved.outcome === 'applied')
      useProjectCommandStore().recordLifecycleWrite(current)
    return { current, applied: resolved.outcome === 'applied' }
  }
  async function change(current: ProjectLifecycleRead) {
    const recovered = await recover(current.id)
    if (recovered)
      return { recovered: true, current: recovered.current }
    const context = await repositories().projectCommands.context()
    const key = projectPendingKey(context, `lifecycle:${current.id}`)
    const commandId = crypto.randomUUID()
    rememberProjectPending(key, commandId)
    await repositories().projectProduction.execute({
      id: current.id,
      commandId,
      workspaceId: context.workspaceId,
      actorId: context.actorId,
      requiredCapability: 'project:write',
      baseVersion: current.version,
      action: current.deletedAt ? 'restore' : 'delete',
    })
    const next = await repositories().projectProduction.lifecycle(current.id)
    clearProjectPending(key, commandId)
    useProjectCommandStore().recordLifecycleWrite(next)
    return { recovered: false, current: next }
  }
  return {
    recover,
    change,
    lifecycle: (id: string) => repositories().projectProduction.lifecycle(id),
    deleted: () => repositories().projectProduction.deleted(),
  }
})
