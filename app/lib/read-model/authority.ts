import type { ProblemDTO } from '../../types/read-model'
import { watch } from 'vue'
import { useProductionAccessStore } from '~/stores/production-access'

/** Existing trusted access events invalidate facts, never the page draft or original command key. */
export function bindReadAuthority(invalidate: (problem: ProblemDTO) => void) {
  const access = useProductionAccessStore()
  return watch(() => {
    const status = access.status
    return JSON.stringify(status?.mode === 'production'
      ? [status.mode, status.authenticated, status.ownerId ?? null, status.purpose, Boolean(access.problem)]
      : [status?.mode ?? null, Boolean(access.problem)])
  }, (_current, previous) => {
    const old = JSON.parse(previous) as unknown[]
    const unauthenticated = (access.status?.mode === 'production' && !access.status.authenticated)
      || (access.status === null && old[0] === 'production' && old[1] === true)
    invalidate({
      code: unauthenticated ? 'unauthenticated' : 'unavailable',
      message: unauthenticated ? '登录已失效，请重新登录后读取。' : '访问状态已变化，请按当前身份重新读取。',
      retryable: !unauthenticated,
      fieldErrors: {},
      traceId: null,
    })
  }, { flush: 'sync' })
}
