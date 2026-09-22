import type { CustomerHttpFetcher } from './http-repository'
import type { CustomerCommandLookup, CustomerLifecycleCommand, CustomerLifecycleRead } from './production-contract'
import { isISODateTimeDTO } from '../../types/read-model'
import { decodeCustomerCommandResult } from './command-http-repository'
import { readCustomerHttp } from './http-repository'
import { customerProblem, CustomerRepositoryProblem } from './repository'

function invalid(): never {
  throw new CustomerRepositoryProblem(customerProblem('unavailable', '客户存储返回的身份或结果无效，请重新核对。'))
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function lifecycle(value: unknown, id?: string): CustomerLifecycleRead {
  if (!object(value) || typeof value.id !== 'string' || (id && value.id !== id) || typeof value.name !== 'string'
    || typeof value.version !== 'string' || !/^[1-9]\d*$/.test(value.version) || !Number.isSafeInteger(Number(value.version))
    || !(value.deletedAt === null || isISODateTimeDTO(value.deletedAt))) {
    return invalid()
  }
  return value as unknown as CustomerLifecycleRead
}
export function createCustomerProductionRepository(fetcher: CustomerHttpFetcher, fileFetcher: (url: string) => Promise<Blob>) {
  return {
    lifecycle: (id: string) => readCustomerHttp(() => fetcher(`/api/read/customers/${encodeURIComponent(id)}/lifecycle`), value => lifecycle(value, id)),
    deleted: () => readCustomerHttp(() => fetcher('/api/read/customers-deleted'), value => Array.isArray(value) ? value.map(item => lifecycle(item)) : invalid()),
    execute: (request: CustomerLifecycleCommand) => readCustomerHttp(() => fetcher(`/api/commands/customers/${encodeURIComponent(request.id)}/lifecycle`, { method: 'POST', body: request }), (value) => {
      const result = decodeCustomerCommandResult(value)
      return result.id === request.id && result.commandId === request.commandId ? result : invalid()
    }),
    resolve: (commandId: string) => readCustomerHttp(() => fetcher('/api/commands/customer-resolve', { method: 'POST', body: { commandId } }), (value): CustomerCommandLookup => {
      if (!object(value) || value.commandId !== commandId)
        return invalid()
      if (value.outcome === 'not-applied' && value.result === null && value.fingerprint === null)
        return { commandId, outcome: 'not-applied', result: null, fingerprint: null }
      if (value.outcome !== 'applied' || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint))
        return invalid()
      const result = decodeCustomerCommandResult(value.result)
      return result.commandId === commandId ? { commandId, outcome: 'applied', result, fingerprint: value.fingerprint } : invalid()
    }),
    file: (id: string, fileId: string) => readCustomerHttp(() => fileFetcher(`/api/read/customers/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`), value => value instanceof Blob ? value : invalid()),
  }
}
