import type { TabRestoreProblemState } from './restoration-contract'

const MESSAGES: Record<TabRestoreProblemState, string> = {
  'not-found': '原记录已不存在',
  'mismatch': '页签身份或来源与当前记录不一致',
  'forbidden': '当前没有查看权限',
  'not-connected': '该详情的只读恢复尚未接入',
  'stale': '原页签恢复上下文已失效',
  'error': '读取失败，可重试或关闭页签',
}

export function restoreProblem(state: TabRestoreProblemState) {
  return { state, message: MESSAGES[state] }
}

export function checkRestoreAbort(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException('页签恢复请求已过期', 'AbortError')
}
