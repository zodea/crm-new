import type { CustomerLifecycleRead } from '~/lib/customer/production-contract'
import { defineStore } from 'pinia'
import { clearCustomerPending, customerPendingKey, readCustomerPending, rememberCustomerPending } from '~/lib/customer/pending'

export const useCustomerProductionStore = defineStore('customer-production', () => {
  const repositories = () => useNuxtApp().$repositories
  async function recover(id: string) {
    const context = await repositories().customerCommands.context()
    const key = customerPendingKey(context, `lifecycle:${id}`)
    const commandId = readCustomerPending(key)
    if (!commandId)
      return null
    const resolved = await repositories().customerProduction.resolve(commandId)
    const current = await repositories().customerProduction.lifecycle(id)
    clearCustomerPending(key, commandId)
    return { current, applied: resolved.outcome === 'applied' }
  }
  async function change(current: CustomerLifecycleRead) {
    const recovered = await recover(current.id)
    if (recovered)
      return { recovered: true, current: recovered.current }
    const context = await repositories().customerCommands.context()
    const key = customerPendingKey(context, `lifecycle:${current.id}`)
    const commandId = crypto.randomUUID()
    rememberCustomerPending(key, commandId)
    await repositories().customerProduction.execute({
      id: current.id,
      commandId,
      workspaceId: context.workspaceId,
      actorId: context.actorId,
      requiredCapability: 'customer:write',
      baseVersion: current.version,
      action: current.deletedAt ? 'restore' : 'delete',
    })
    const next = await repositories().customerProduction.lifecycle(current.id)
    clearCustomerPending(key, commandId)
    return { recovered: false, current: next }
  }
  return {
    recover,
    change,
    lifecycle: (id: string) => repositories().customerProduction.lifecycle(id),
    deleted: () => repositories().customerProduction.deleted(),
  }
})
