import type { H3Event } from 'h3'
import { createProductionPayrollImport } from './production-payroll-import'
import { createProductionPayrollService } from './production-payroll-service'
import { productionRuntime, productionSession } from './production-runtime'

const services = new WeakMap<object, ReturnType<typeof createProductionPayrollService>>()
const imports = new WeakMap<object, ReturnType<typeof createProductionPayrollImport>>()
export function productionPayrollRuntime(event: H3Event) {
  const runtime = productionRuntime()
  if (!runtime)
    return null
  let service = services.get(runtime.storage)
  if (!service) {
    service = createProductionPayrollService(runtime.storage)
    services.set(runtime.storage, service)
  }
  const session = productionSession(event)
  let migration = imports.get(runtime.storage)
  if (!migration) {
    migration = createProductionPayrollImport(runtime.storage)
    imports.set(runtime.storage, migration)
  }
  return { payroll: service.forSession(session), workbook: service.workbook(session), resolve: (descriptor: Parameters<typeof service.resolve>[0]) => service.resolve(descriptor, session), migration: { state: () => migration!.state(session), execute: (input: unknown) => migration!.execute(input, session), resolve: (commandId: string) => migration!.resolve(commandId, session) } }
}
