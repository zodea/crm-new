import type { ProjectCommandRequestDTO } from '../../app/lib/project/command-contract'
import { PROJECT_WRITE_CAPABILITY } from '../../app/lib/project/command-contract'
import { projectProblem, ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { decodeProjectCommandContent } from './project-command-domain'

const ACTIONS = new Set(['draft', 'save', 'submit'])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(message: string): never {
  throw new ProjectRepositoryProblem(projectProblem('validation-failed', message))
}

export function parseProjectCommandRequest(
  value: unknown,
  routeId?: string,
): ProjectCommandRequestDTO {
  if (!isObject(value))
    return fail('项目命令请求无效')
  if (typeof value.workspaceId !== 'string'
    || typeof value.actorId !== 'string'
    || value.requiredCapability !== PROJECT_WRITE_CAPABILITY
    || typeof value.commandId !== 'string'
    || !(value.baseVersion === null || typeof value.baseVersion === 'string')
    || !ACTIONS.has(String(value.action))) {
    return fail('项目命令信封无效')
  }
  if (routeId && value.id !== routeId)
    return fail('路由项目 ID 与命令不匹配')
  if (!routeId && value.id !== undefined)
    return fail('新建命令不能指定项目 ID')
  const content = decodeProjectCommandContent(value.draft, value.attachments)
  return {
    ...(routeId ? { id: routeId } : {}),
    workspaceId: value.workspaceId,
    actorId: value.actorId,
    requiredCapability: PROJECT_WRITE_CAPABILITY,
    commandId: value.commandId,
    baseVersion: value.baseVersion,
    action: value.action as ProjectCommandRequestDTO['action'],
    draft: content.draft,
    attachments: content.attachments,
  }
}
