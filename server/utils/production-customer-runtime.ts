import type { H3Event } from 'h3'
import { createError } from 'h3'
import { customerProblem } from '../../app/lib/customer/repository'
import { requireProductionBusinessSession } from './production-auth'
import { getProductionRuntimeConfig } from './production-config'
import { createProductionCustomerService } from './production-customer-service'
import { createProductionStorage, ProductionStorageProblem } from './production-storage'

let runtime: { key: string, storage: ReturnType<typeof createProductionStorage>, customers: ReturnType<typeof createProductionCustomerService> } | null = null
export function productionCustomerRuntime() {
  const config = getProductionRuntimeConfig()
  if (!config)
    return null
  const key = JSON.stringify([config.directory, config.workspaceId, config.ownerId, config.purpose])
  if (runtime && runtime.key !== key)
    throw createError({ statusCode: 503, data: customerProblem('unavailable', '运行中存储身份配置发生变化，请停止服务后按维护流程重新启动。') })
  if (!runtime) {
    const storage = createProductionStorage(config)
    runtime = { key, storage, customers: createProductionCustomerService(storage) }
  }
  return runtime
}
export const productionCustomerSession = (event: H3Event) => () => requireProductionBusinessSession(event)
export function requireProductionCustomers() {
  const value = productionCustomerRuntime()
  if (!value)
    throw createError({ statusCode: 503, data: customerProblem('unavailable', '此入口需要已配置的正式磁盘运行时。') })
  return value.customers
}
export function throwProductionStorageError(cause: unknown) {
  if (cause instanceof ProductionStorageProblem)
    throw createError({ statusCode: 503, data: customerProblem('unavailable', cause.message) })
}
