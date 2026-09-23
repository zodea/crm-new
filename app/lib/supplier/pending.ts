import { credentialProblem } from './credential-contract'

export const SUPPLIER_PERSISTENT_CAPABILITY = 'supplier:persistent:write'
export interface SupplierPendingContext { workspaceId: string, actorId: string }
/** Only the original command key is stored; never form fields, OCR text or original bytes. */
export function supplierPendingKey(context: SupplierPendingContext, target: string) {
  return `crm:supplier-command:v1:${encodeURIComponent(context.workspaceId)}:${encodeURIComponent(context.actorId)}:${encodeURIComponent(target)}`
}
function unavailable(): never {
  throw credentialProblem('unavailable', '无法可靠保留原提交编号，请保留输入并恢复浏览器存储后重试。')
}
export function readSupplierPending(key: string): string | null {
  try {
    const value = window.sessionStorage.getItem(key)
    if (value !== null && !/^[a-z0-9][\w-]{2,79}$/i.test(value))
      unavailable()
    return value
  }
  catch { return unavailable() }
}
export function rememberSupplierPending(key: string, commandId: string) {
  if (readSupplierPending(key))
    throw credentialProblem('conflict', '请先核对分供方上次提交，再保存新内容。')
  try {
    window.sessionStorage.setItem(key, commandId)
    if (readSupplierPending(key) !== commandId)
      unavailable()
  }
  catch { unavailable() }
}
export function clearSupplierPending(key: string, commandId: string) {
  if (readSupplierPending(key) !== commandId)
    throw credentialProblem('conflict', '分供方原提交编号已经变化，请重新核对。')
  try {
    window.sessionStorage.removeItem(key)
    if (readSupplierPending(key) !== null)
      unavailable()
  }
  catch { unavailable() }
}
export function supplierPendingTargets(context: SupplierPendingContext): string[] {
  const prefix = supplierPendingKey(context, '')
  try {
    const result: string[] = []
    for (let index = 0; index < window.sessionStorage.length; index++) {
      const key = window.sessionStorage.key(index)
      if (key?.startsWith(prefix) && readSupplierPending(key))
        result.push(decodeURIComponent(key.slice(prefix.length)))
    }
    return result
  }
  catch { return unavailable() }
}
