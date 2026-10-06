import { createProductionNotificationService } from './production-notification-service'
import { productionRuntime } from './production-runtime'

const services = new WeakMap<object, ReturnType<typeof createProductionNotificationService>>()
export function productionNotificationRuntime() {
  const runtime = productionRuntime()
  if (!runtime)
    return null
  let notifications = services.get(runtime.storage)
  if (!notifications) {
    notifications = createProductionNotificationService(runtime.storage)
    services.set(runtime.storage, notifications)
  }
  return { storage: runtime.storage, notifications }
}
