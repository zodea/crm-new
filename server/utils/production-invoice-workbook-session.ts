import type { BusinessSession } from './business-session'
import { createError, isError } from 'h3'
import { CentralInvoiceProblem } from '../../app/lib/invoice/central-contract'
import { throwProductionInvoiceError } from './production-invoice-runtime'

/** 仅识别工作簿端点调用可信会话回调时发生的认证失效。 */
class WorkbookSessionFailure extends Error {
  constructor(readonly statusCode: 401 | 403) {
    super('工作簿会话不可用。')
  }
}

export function workbookSession(session: () => BusinessSession): () => BusinessSession {
  return () => {
    try {
      return session()
    }
    catch (cause) {
      if (isError(cause) && (cause.statusCode === 401 || cause.statusCode === 403))
        throw new WorkbookSessionFailure(cause.statusCode)
      throw cause
    }
  }
}

export function throwWorkbookCommandError(cause: unknown): never {
  if (cause instanceof WorkbookSessionFailure) {
    const code = cause.statusCode === 401 ? 'unauthenticated' : 'forbidden'
    const message = cause.statusCode === 401 ? '登录已失效，请重新登录后重试。' : '当前身份无权执行此操作，请重新核对。'
    throw createError({ statusCode: cause.statusCode, data: new CentralInvoiceProblem(code, message).problem })
  }
  return throwProductionInvoiceError(cause)
}
