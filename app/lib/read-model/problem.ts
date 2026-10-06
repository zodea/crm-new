import type { ProblemDTO } from '../../types/read-model'
import { isProblemCodeDTO } from '../../types/read-model'

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Copy only the public problem fields; transport bodies never become cached facts. */
export function decodeProblemDTO(value: unknown): ProblemDTO | null {
  if (!object(value) || !isProblemCodeDTO(value.code) || typeof value.message !== 'string'
    || typeof value.retryable !== 'boolean' || !object(value.fieldErrors)
    || !(value.traceId === null || typeof value.traceId === 'string')) {
    return null
  }
  const fieldErrors: Record<string, string[]> = {}
  for (const [field, messages] of Object.entries(value.fieldErrors)) {
    if (!Array.isArray(messages) || !messages.every(message => typeof message === 'string'))
      return null
    Object.defineProperty(fieldErrors, field, { value: [...messages], enumerable: true, configurable: true, writable: true })
  }
  return { code: value.code, message: value.message, retryable: value.retryable, fieldErrors, traceId: value.traceId }
}

/** An actual 401/403 remains an authority failure even when its error body is damaged. */
export function problemFromHttpFailure(cause: unknown): ProblemDTO | null {
  if (!object(cause))
    return null
  const response = object(cause.response) ? cause.response : null
  const status = response?.status ?? cause.statusCode ?? cause.status
  const raw = response?._data ?? cause.data
  const candidate = object(raw) && object(raw.data) ? raw.data : raw
  const decoded = decodeProblemDTO(candidate) ?? decodeProblemDTO(cause.problem)
  if (status === 401 && decoded?.code !== 'unauthenticated')
    return { code: 'unauthenticated', message: '登录已失效，请重新登录后读取。', retryable: false, fieldErrors: {}, traceId: null }
  if (status === 403 && decoded?.code !== 'forbidden')
    return { code: 'forbidden', message: '当前没有查看或执行此操作的权限。', retryable: false, fieldErrors: {}, traceId: null }
  return decoded
}

/** A rejection can release a command only when its proof names this exact original command. */
export function commandProblemFromHttpFailure(cause: unknown, commandId: string): ProblemDTO | null {
  const decoded = problemFromHttpFailure(cause)
  if (!decoded || !object(cause) || !['validation-failed', 'stale-source', 'relationship-mismatch', 'not-found', 'conflict'].includes(decoded.code))
    return decoded
  const response = object(cause.response) ? cause.response : null
  const body = response?._data ?? cause.data
  const raw = object(body) && object(body.data) ? body.data : body
  const proof = object(raw) ? raw : object(cause.problem) ? cause.problem : null
  return proof?.commandId === commandId && proof.commandOutcome === 'not-applied'
    ? Object.assign(decoded, { commandId, commandOutcome: 'not-applied' as const })
    : decoded
}
