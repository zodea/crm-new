import { createError } from 'h3'
import { customerProblem } from '../../app/lib/customer/repository'
import { createProductionCustomerService } from './production-customer-service'
import { productionRuntime } from './production-runtime'

export { productionSession as productionCustomerSession } from './production-runtime'

let runtime: (NonNullable<ReturnType<typeof productionRuntime>> & { customers: ReturnType<typeof createProductionCustomerService> }) | null = null
export function productionCustomerRuntime() {
  const base = productionRuntime()
  if (!base)
    return null
  if (!runtime)
    runtime = { ...base, customers: createProductionCustomerService(base.storage) }
  return runtime
}
export function requireProductionCustomers() {
  const value = productionCustomerRuntime()
  if (!value)
    throw createError({ statusCode: 503, data: customerProblem('unavailable', '此入口需要已配置的正式磁盘运行时。') })
  return value.customers
}
