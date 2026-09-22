import { isAbsolute } from 'node:path'
import process from 'node:process'
import { createError } from 'h3'

export interface ProductionRuntimeConfig {
  directory: string
  workspaceId: string
  ownerId: string
  purpose: 'verification' | 'production'
  origin: string
  accessCodeHash: string
}

/** Read on every boundary: changing credentials or identity revokes existing sessions. */
export function getProductionRuntimeConfig(): ProductionRuntimeConfig | null {
  const invalid = (): never => {
    throw createError({ statusCode: 503, message: '本机运行配置未就绪，请维护人核对配置；不会使用测试数据替代。' })
  }
  if (!process.env.CRM_RUN_MODE || process.env.CRM_RUN_MODE === 'development')
    return null
  if (process.env.CRM_RUN_MODE !== 'production')
    invalid()
  const directory = process.env.CRM_DATA_DIRECTORY ?? ''
  const workspaceId = process.env.CRM_WORKSPACE_ID ?? ''
  const ownerId = process.env.CRM_OWNER_ID ?? ''
  const purpose = process.env.CRM_DATA_PURPOSE ?? 'production'
  const origin = process.env.CRM_PUBLIC_ORIGIN ?? ''
  const accessCodeHash = process.env.CRM_ACCESS_CODE_HASH ?? ''
  if (process.env.NITRO_HOST !== '127.0.0.1' || !isAbsolute(directory) || directory.startsWith('\\\\')
    || !/^[A-Z0-9][\w-]{2,79}$/i.test(workspaceId)
    || !/^[A-Z0-9][\w-]{2,79}$/i.test(ownerId)
    || !['verification', 'production'].includes(purpose)
    || !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(accessCodeHash)) {
    invalid()
  }
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin !== origin)
      invalid()
  }
  catch { invalid() }
  return Object.freeze({ directory, workspaceId, ownerId, purpose: purpose as ProductionRuntimeConfig['purpose'], origin, accessCodeHash })
}
