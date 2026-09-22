import type { CustomerCommandContextDTO } from './command-contract'
import { customerProblem, CustomerRepositoryProblem } from './repository'

/** Only a scoped command key is retained. Customer fields and original bytes never enter browser storage. */
export function customerPendingKey(context: CustomerCommandContextDTO, target: string) {
  return `crm:customer-command:v1:${encodeURIComponent(context.workspaceId)}:${encodeURIComponent(context.actorId)}:${encodeURIComponent(target)}`
}
function unavailable(): never {
  throw new CustomerRepositoryProblem(customerProblem('unavailable', '无法可靠保留原提交编号，请保留输入，恢复浏览器存储后重试。'))
}
export function readCustomerPending(key: string): string | null {
  try {
    const value = window.sessionStorage.getItem(key)
    if (value !== null && !/^[a-z0-9][\w-]{2,79}$/i.test(value))
      return unavailable()
    return value
  }
  catch { return unavailable() }
}
export function rememberCustomerPending(key: string, commandId: string) {
  if (readCustomerPending(key))
    throw new CustomerRepositoryProblem(customerProblem('conflict', '请先核对上次提交，再保存新的内容。'))
  try {
    window.sessionStorage.setItem(key, commandId)
    if (readCustomerPending(key) !== commandId)
      unavailable()
  }
  catch { unavailable() }
}
export function clearCustomerPending(key: string, commandId: string) {
  if (readCustomerPending(key) !== commandId)
    throw new CustomerRepositoryProblem(customerProblem('conflict', '原提交编号已经变化，请重新核对。'))
  try {
    window.sessionStorage.removeItem(key)
    if (readCustomerPending(key) !== null)
      unavailable()
  }
  catch { unavailable() }
}
