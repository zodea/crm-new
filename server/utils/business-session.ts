export interface BusinessSession {
  workspaceId: string
  actorId: string
  capabilities: readonly string[]
}

const DEFAULT_BUSINESS_SESSION = Object.freeze<BusinessSession>({
  workspaceId: 'workspace-default',
  actorId: 'actor-default',
  capabilities: Object.freeze([
    'process-library:read',
    'process-library:write',
    'quantity:read',
    'quantity:write',
    'delivery:read',
    'delivery:write',
    'receipt:read',
    'receipt:write',
    'other-settlement:read',
    'other-settlement:write',
    'auxiliary-contract:read',
    'auxiliary-contract:write',
    'project:list:read',
    'project:write',
    'customer:list:read',
    'customer:write',
    'supplier:list:read',
    'supplier:write',
    'supplier-credential:read',
    'supplier-credential:write',
    'subcontract-contract:read',
    'subcontract-contract:write',
    'construction-contract:read',
    'construction-contract:write',
    'owner-document:read',
    'owner-document:write',
    'subcontract-document:read',
    'subcontract-document:write',
    'material-contract:read',
    'material-contract:write',
    'project-supplier:read',
    'project-supplier:write',
    'crew:list:read',
    'crew:write',
    'worker:list:read',
    'worker:write',
    'demo:read',
    'core:migration:write',
  ]),
})

/**
 * 单公司、单操作人首版由服务端注入会话；客户端请求不能覆盖这些身份。
 * 正式登录接入后只替换此解析边界，不改变领域 DTO 或 Repository。
 */
export function resolveBusinessSession(): BusinessSession {
  return DEFAULT_BUSINESS_SESSION
}
