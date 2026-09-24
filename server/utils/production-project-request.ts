import { decodeProjectImportSource, projectImportSourceKey } from '../../app/lib/project/import'
import { projectFailure as fail } from './production-project-record'
import { parseProjectCommandRequest } from './project-command-request'

export function productionProjectId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z0-9][\w-]{2,79}$/i.test(value)
}
export function productionProjectCommandId(value: unknown): value is string {
  if (productionProjectId(value))
    return true
  if (typeof value !== 'string' || !value.startsWith('project-excel:') || value.length > 4096)
    return false
  try {
    const tuple: unknown = JSON.parse(value.slice('project-excel:'.length))
    return Array.isArray(tuple) && tuple.length === 3 && typeof tuple[0] === 'string' && /^[a-f0-9]{64}$/.test(tuple[0])
      && typeof tuple[1] === 'string' && !!tuple[1].trim() && Number.isSafeInteger(tuple[2]) && Number(tuple[2]) >= 1
      && value === `project-excel:${JSON.stringify(tuple)}`
  }
  catch { return false }
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
/** Reject source overrides before the legacy decoder can discard them. */
export function parseProductionProjectRequest(value: unknown, routeId?: string | null) {
  const fields = ['id', 'workspaceId', 'actorId', 'requiredCapability', 'commandId', 'baseVersion', 'action', 'draft', 'attachments', 'importSource']
  if (!object(value) || Object.keys(value).some(key => !fields.includes(key)) || !productionProjectCommandId(value.commandId))
    return fail('validation-failed', '项目命令字段或可恢复的提交编号无效，正式入口不接受其他来源。')
  if (!object(value.attachments) || Object.keys(value.attachments).some(key => !['add', 'removeIds', 'restoreIds'].includes(key)))
    return fail('validation-failed', '项目附件变更字段无效。')
  if (Array.isArray(value.attachments.add) && value.attachments.add.some(file => !object(file) || Object.keys(file).some(key => !['fileName', 'fileSize', 'mimeType', 'category', 'contentBase64'].includes(key))))
    return fail('validation-failed', '项目原件只接受文件正文及描述，不接受客户端路径或归属。')
  const id = routeId === undefined ? value.id : routeId
  if (id !== undefined && id !== null && !productionProjectId(id))
    return fail('validation-failed', '项目身份无效。')
  const request = parseProjectCommandRequest(value, id === null ? undefined : id as string | undefined)
  if (request.draft.id !== undefined && request.draft.id !== request.id)
    return fail('relationship-mismatch', '项目表单身份与当前命令目标不一致。')
  if (request.commandId.startsWith('project-excel:')) {
    if (!request.importSource || request.commandId !== `project-excel:${projectImportSourceKey(decodeProjectImportSource(request.importSource))}`)
      return fail('validation-failed', 'Excel 提交编号与原来源行不一致。')
  }
  return request
}
