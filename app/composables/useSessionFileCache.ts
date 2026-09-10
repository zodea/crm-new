import { useTimeoutFn } from '@vueuse/core'
import { onScopeDispose } from 'vue'

/** 保留活动原文件；离开工作集后给撤回留出短窗口，到期释放强引用。 */
export function useSessionFileCache(retentionMs = 10_000, onRelease?: (id: string) => void) {
  const files = new Map<string, { file: File, expiresAt: number | null }>()
  let delay = retentionMs
  const timer = useTimeoutFn(expire, () => delay, { immediate: false })

  function release(id: string) {
    files.delete(id)
    onRelease?.(id)
  }

  function schedule() {
    timer.stop()
    let next = Number.POSITIVE_INFINITY
    for (const entry of files.values())
      next = Math.min(next, entry.expiresAt ?? Number.POSITIVE_INFINITY)
    if (Number.isFinite(next)) {
      delay = Math.max(0, next - Date.now())
      timer.start()
    }
  }

  function expire() {
    const now = Date.now()
    for (const [id, entry] of files) {
      if (entry.expiresAt != null && entry.expiresAt <= now)
        release(id)
    }
    schedule()
  }

  function sync(activeIds: Iterable<string>) {
    const active = new Set(activeIds)
    const deadline = Date.now() + retentionMs
    for (const [id, entry] of files)
      entry.expiresAt = active.has(id) ? null : entry.expiresAt ?? deadline
    schedule()
  }

  function clear() {
    timer.stop()
    for (const id of files.keys())
      release(id)
  }

  onScopeDispose(clear)
  return {
    get: (id: string) => files.get(id)?.file,
    set(id: string, file: File) {
      files.set(id, { file, expiresAt: null })
    },
    sync,
    clear,
  }
}
