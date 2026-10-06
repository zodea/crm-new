import type { H3Event } from 'h3'
import { createError, getQuery } from 'h3'
import { financeFailure, financeProblemFromUnknown, FinanceRepositoryProblem } from '../../app/lib/finance/central-contract'
import { financeKind } from './production-finance-request'
import { productionFinanceRuntime } from './production-finance-runtime'
import { productionSession, throwProductionStorageError } from './production-runtime'

export function financeApi(event: H3Event, lookupQuery = false) {
  if (event.method === 'GET' && !lookupQuery && Object.keys(getQuery(event)).length)
    financeFailure('invalid-query', '此财务读取不接受额外查询范围。')
  const runtime = productionFinanceRuntime()
  if (!runtime)
    financeFailure('unavailable', '财务正式持久来源尚未配置，不能借用浏览器旧库或开发实例保存。')
  return { ...runtime, session: productionSession(event) }
}
export function financeRouteKind(event: H3Event) {
  return financeKind(event.context.params?.kind)
}
export function throwFinanceError(cause: unknown): never {
  throwProductionStorageError(cause)
  const failure = cause instanceof FinanceRepositoryProblem ? cause : financeProblemFromUnknown(cause)
  if (failure) {
    const status: Record<string, number> = { 'unauthenticated': 401, 'forbidden': 403, 'validation-failed': 422, 'invalid-query': 400, 'conflict': 409, 'not-found': 404, 'unavailable': 503 }
    throw createError({ statusCode: status[failure.problem.code] ?? 503, message: failure.problem.message, data: failure.problem })
  }
  throw createError({ statusCode: 503, message: '财务持久来源暂时无法可靠使用，请保留原提交编号。', data: { code: 'unavailable', message: '财务持久来源暂时无法可靠使用，请保留原提交编号。', retryable: true, fieldErrors: {}, traceId: null } })
}
