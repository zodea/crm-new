import { createError } from 'h3'
import { CentralInvoiceProblem } from '../../app/lib/invoice/central-contract'
import { createProductionInvoiceCorrectionService } from './production-invoice-correction-service'
import { createProductionInvoiceService } from './production-invoice-service'
import { productionRuntime, throwProductionStorageError } from './production-runtime'

export { productionSession as productionInvoiceSession } from './production-runtime'

const services = new WeakMap<object, ReturnType<typeof createProductionInvoiceService>>()
const correctionServices = new WeakMap<object, ReturnType<typeof createProductionInvoiceCorrectionService>>()
export function requireProductionInvoices() {
  const runtime = productionRuntime()
  if (!runtime)
    throw createError({ statusCode: 503, data: new CentralInvoiceProblem('unavailable', '发票中央存储尚未就绪。').problem })
  let service = services.get(runtime.storage)
  if (!service) {
    service = createProductionInvoiceService(runtime.storage)
    services.set(runtime.storage, service)
  }
  return service
}

export function requireProductionInvoiceCorrections() {
  const runtime = productionRuntime()
  if (!runtime)
    throw createError({ statusCode: 503, data: new CentralInvoiceProblem('unavailable', '发票中央存储尚未就绪。').problem })
  let service = correctionServices.get(runtime.storage)
  if (!service) {
    service = createProductionInvoiceCorrectionService(runtime.storage, { invoice: requireProductionInvoices().correctionPort })
    correctionServices.set(runtime.storage, service)
  }
  return service
}

export function throwProductionInvoiceError(cause: unknown): never {
  throwProductionStorageError(cause)
  if (cause instanceof CentralInvoiceProblem) {
    const statusCode = cause.problem.code === 'forbidden' ? 403 : cause.problem.code === 'not-found' ? 404 : cause.problem.code === 'conflict' ? 409 : cause.problem.code === 'unavailable' ? 503 : 422
    throw createError({ statusCode, data: cause.problem })
  }
  throw createError({ statusCode: 503, data: new CentralInvoiceProblem('unavailable', '发票来源暂时不可用，请保留输入并核对原提交。').problem })
}
