import type { H3Event } from 'h3'
import { createProductionQuantityImport } from './production-quantity-migration'
import { createProductionQuantityService } from './production-quantity-service'
import { productionRuntime, productionSession } from './production-runtime'

const services = new WeakMap<object, ReturnType<typeof createProductionQuantityService>>()
const imports = new WeakMap<object, ReturnType<typeof createProductionQuantityImport>>()
export function productionQuantityRuntime(event: H3Event) {
  const runtime = productionRuntime()
  if (!runtime)
    return null
  let service = services.get(runtime.storage)
  if (!service) {
    service = createProductionQuantityService(runtime.storage)
    services.set(runtime.storage, service)
  }
  const session = productionSession(event)
  let importer = imports.get(runtime.storage)
  if (!importer) {
    importer = createProductionQuantityImport(runtime.storage)
    imports.set(runtime.storage, importer)
  }
  return { quantity: service.forSession(session), resolve: (descriptor: Parameters<typeof service.resolve>[0]) => service.resolve(descriptor, session), imports: { catalog: () => importer!.catalog(session), execute: (command: unknown) => importer!.execute(command, session), restore: (command: Parameters<typeof importer.restore>[0]) => importer!.restore(command, session), resolve: (descriptor: Parameters<typeof importer.resolve>[0]) => importer!.resolve(descriptor, session) } }
}
