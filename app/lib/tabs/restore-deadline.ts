/** 超时或新导航结束等待；旧网络适配未支持取消时，其迟到结果也不会继续恢复。 */
export function withTabRestoreDeadline<T>(read: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, timeoutMs = 10000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController()
    const aborted = () => {
      controller.abort()
      const error = new Error('页面恢复已取消')
      error.name = 'AbortError'
      reject(error)
    }
    const timer = setTimeout(() => {
      controller.abort()
      reject(new Error('页面恢复读取超时'))
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', aborted)
    }
    if (signal?.aborted) {
      aborted()
      cleanup()
      return
    }
    signal?.addEventListener('abort', aborted, { once: true })
    // 超时和外部取消也必须释放计时器与监听器，无需等待旧适配返回。
    controller.signal.addEventListener('abort', cleanup, { once: true })
    try {
      Promise.resolve(read(controller.signal)).then(resolve, reject).finally(cleanup)
    }
    catch (cause) {
      cleanup()
      reject(cause)
    }
  })
}
