import type { H3Event } from 'h3'
import { createError } from 'h3'
import { requireProductionBusinessSession } from './production-auth'
import { getProductionRuntimeConfig } from './production-config'
import { FINANCE_CAPABILITIES } from './production-finance-access'

export interface BusinessSession {
  workspaceId: string
  actorId: string
  capabilities: readonly string[]
}

const DEFAULT_BUSINESS_SESSION = Object.freeze<BusinessSession>({
  workspaceId: 'workspace-default',
  actorId: 'actor-default',
  capabilities: Object.freeze([
    ...FINANCE_CAPABILITIES,
    'payroll:read',
    'payroll:write',
    'target-cost:read',
    'target-cost:write',
    'schedule:read',
    'schedule:write',
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
    'material-quotation:read',
    'material-quotation:write',
    'our-signatory:read',
    'our-signatory:write',
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
 * 正式模式必须由当前已认证的请求注入，开发适配保持原契约。
 */
export function resolveBusinessSession(event?: H3Event): BusinessSession {
  if (getProductionRuntimeConfig()) {
    if (!event)
      throw createError({ statusCode: 401, message: '正式业务必须使用已认证的请求会话。' })
    return requireProductionBusinessSession(event)
  }
  return DEFAULT_BUSINESS_SESSION
}
