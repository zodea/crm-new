import { parseCustomerCommandRequest } from './customer-command-request'
import { customerFailure as fail } from './production-customer-record'

export function productionCustomerId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z0-9][\w-]{2,79}$/i.test(value)
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
/** Reject source overrides before the legacy decoder can discard them. */
export function parseProductionCustomerRequest(value: unknown, routeId?: string | null) {
  const fields = ['id', 'workspaceId', 'actorId', 'requiredCapability', 'commandId', 'baseVersion', 'action', 'draft', 'attachments']
  if (!object(value) || Object.keys(value).some(key => !fields.includes(key)) || !productionCustomerId(value.commandId))
    return fail('validation-failed', '客户命令字段或可恢复的提交编号无效，正式入口不接受其他来源。')
  if (!object(value.attachments) || Object.keys(value.attachments).some(key => !['add', 'removeIds', 'restoreIds'].includes(key)))
    return fail('validation-failed', '客户附件变更字段无效。')
  if (Array.isArray(value.attachments.add) && value.attachments.add.some(file => !object(file) || Object.keys(file).some(key => !['fileName', 'fileSize', 'mimeType', 'category', 'contentBase64'].includes(key))))
    return fail('validation-failed', '客户原件只接受文件正文及描述，不接受客户端路径或归属。')
  const id = routeId === undefined ? value.id : routeId
  if (id !== undefined && id !== null && !productionCustomerId(id))
    return fail('validation-failed', '客户身份无效。')
  return parseCustomerCommandRequest(value, id === null ? undefined : id as string | undefined)
}
