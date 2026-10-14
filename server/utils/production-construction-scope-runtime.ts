import type { H3Event } from 'h3'
import { financeFailure } from '../../app/lib/finance/central-contract'
import { createProductionConstructionScopeService } from './production-construction-scope-service'
import { productionRuntime, productionSession } from './production-runtime'

const services = new WeakMap<object, ReturnType<typeof createProductionConstructionScopeService>>()
export function productionConstructionScopeRuntime(event: H3Event) {
  const runtime = productionRuntime()
  if (!runtime)
    return financeFailure('unavailable', '施工合同关联只接实际正式存储，不能借用开发来源。')
  let service = services.get(runtime.storage)
  if (!service) {
    service = createProductionConstructionScopeService(runtime.storage)
    services.set(runtime.storage, service)
  }
  const session = productionSession(event)
  return { storage: runtime.storage, session, read: (source: Parameters<typeof service.read>[0]) => service!.read(source, session), execute: (command: unknown) => service!.execute(command, session), resolve: (descriptor: Parameters<typeof service.resolve>[0]) => service!.resolve(descriptor, session) }
}
