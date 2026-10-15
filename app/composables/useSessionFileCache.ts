import { useTimeoutFn } from '@vueuse/core'
import { onScopeDispose, shallowRef } from 'vue'

/**
 * 保留活动原文件；离开工作集后给撤回留出短窗口，到期释放强引用。
 * 每个原文件可附带一份随之存亡的会话数据（如本次识别的字段区域），文件释放即一并释放。
 * 文件与附带数据本身不进入响应式代理；读取经版本号追踪，进出会话时依赖它的 computed 会重新求值。
 */
export function useSessionFileCache<Meta = never>(retentionMs = 10_000, onRelease?: (id: string) => void) {
  const files = new Map<string, { file: File, meta?: Meta, expiresAt: number | null }>()
  const version = shallowRef(0)
  let delay = retentionMs
  const timer = useTimeoutFn(expire, () => delay, { immediate: false })

  function changed() {
    version.value++
  }

  function entry(id: string) {
    void version.value
    return files.get(id)
  }

  function release(id: string) {
    files.delete(id)
    changed()
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
    get: (id: string) => entry(id)?.file,
    set(id: string, file: File) {
      files.set(id, { file, expiresAt: null })
      changed()
    },
    /** 原文件附带的会话数据；原文件不在会话中时为 undefined。 */
    getMeta: (id: string) => entry(id)?.meta,
    /** 只给仍在会话中的原文件附带数据；原文件已释放时不保存（返回 false）。 */
    setMeta(id: string, meta: Meta | undefined) {
      const current = files.get(id)
      if (!current)
        return false
      current.meta = meta
      changed()
      return true
    },
    sync,
    clear,
  }
}
