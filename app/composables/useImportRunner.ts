import type { ShallowRef } from 'vue'
import type { ImportRunPhase } from '~/lib/kit/import-mapping'
import { nextTick, shallowRef } from 'vue'
import { toErrorMessage } from '~/lib/util/error'

export type ImportRunResult
  = | { status: 'completed', rejected?: readonly ImportRowRejection[] }
    | { status: 'failed', error: unknown }
    | { status: 'cancelled' }

export interface ImportRowRejection {
  /** 保留传入 rows 中的 0 起始索引，页面可映射回原始工作表行号。 */
  index: number
  row: Record<string, unknown>
  reason: string
}

export type ImportRowValidator = (
  row: Record<string, unknown>,
  index: number,
) => string | null | undefined | Promise<string | null | undefined>

export interface ImportRunnerEnvironment {
  /** 注入 seam：生产中让 Vue 提交一次 DOM，单测可用立即 resolved。 */
  yieldToView: () => Promise<void>
}

export interface ImportRunner {
  phase: ShallowRef<ImportRunPhase>
  error: ShallowRef<string | null>
  done: ShallowRef<number>
  total: ShallowRef<number>
  rejected: ShallowRef<readonly ImportRowRejection[]>
  start: (
    rows: readonly Record<string, unknown>[],
    importRow: (row: Record<string, unknown>) => Promise<void>,
    validateRow?: ImportRowValidator,
  ) => Promise<ImportRunResult>
  retry: () => Promise<ImportRunResult>
  reset: () => void
  /** 页签卸载时调用：当前行完成后停止推进，不再入库剩余行。 */
  cancel: () => void
}

/** 逐行入库执行器：失败停在当前行，重试从失败行续导，不重复已成功行。 */
export function useImportRunner(
  environment: ImportRunnerEnvironment = { yieldToView: () => nextTick() },
): ImportRunner {
  const phase = shallowRef<ImportRunPhase>('idle')
  const error = shallowRef<string | null>(null)
  const done = shallowRef(0)
  const total = shallowRef(0)
  const rejected = shallowRef<readonly ImportRowRejection[]>([])
  let pendingRows: readonly Record<string, unknown>[] = []
  let sink: ((row: Record<string, unknown>) => Promise<void>) | null = null
  let validator: ImportRowValidator | null = null
  let cancelled = false
  let lastYieldAt = 0

  function reset() {
    phase.value = 'idle'
    error.value = null
    done.value = 0
    total.value = 0
    rejected.value = []
    pendingRows = []
    sink = null
    validator = null
    cancelled = false
  }

  function cancel() {
    cancelled = true
  }

  async function runFromCursor(): Promise<ImportRunResult> {
    phase.value = 'running'
    error.value = null

    while (done.value < pendingRows.length) {
      if (cancelled) {
        phase.value = 'idle'
        return { status: 'cancelled' }
      }
      // 时间片让出：约一帧一次即可保住进度渲染，避免每行强制 flush 放大批量耗时。
      const now = Date.now()
      if (now - lastYieldAt >= 16) {
        await environment.yieldToView()
        lastYieldAt = Date.now()
      }
      const row = pendingRows[done.value]!
      try {
        const reason = validator ? await validator(row, done.value) : null
        if (reason) {
          rejected.value = [
            ...rejected.value,
            { index: done.value, row, reason },
          ]
          done.value += 1
          continue
        }
        await sink!(row)
      }
      catch (cause) {
        phase.value = 'failed'
        error.value = toErrorMessage(cause)
        return { status: 'failed', error: cause }
      }
      done.value += 1
    }

    phase.value = 'completed'
    return rejected.value.length
      ? { status: 'completed', rejected: rejected.value }
      : { status: 'completed' }
  }

  async function start(
    rows: readonly Record<string, unknown>[],
    importRow: (row: Record<string, unknown>) => Promise<void>,
    validateRow?: ImportRowValidator,
  ): Promise<ImportRunResult> {
    if (phase.value === 'running')
      throw new Error('导入正在进行中')
    reset()
    pendingRows = [...rows]
    sink = importRow
    validator = validateRow ?? null
    total.value = pendingRows.length
    return await runFromCursor()
  }

  async function retry(): Promise<ImportRunResult> {
    if (phase.value !== 'failed')
      throw new Error('只有失败的导入可以重试')
    return await runFromCursor()
  }

  return { phase, error, done, total, rejected, start, retry, reset, cancel }
}
