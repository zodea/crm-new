export interface PayrollReleaseCurrentState {
  status: string
  needsRecheck: boolean
}

/**
 * 原发放命令返回需重核后，分别说明原提交结果与回读到的当前状态；
 * 当前记录可能已在其他窗口重核或发放，不能一律要求“请先重新核对”。
 */
export function payrollNeedsRecheckMessage(changedSource: string, current: PayrollReleaseCurrentState): string {
  const currentState = current.status === 'released'
    ? '当前记录随后已发放，本页保持只读。'
    : current.needsRecheck
      ? '当前记录仍需重核，请先重新核对。'
      : current.status === 'checked'
        ? '当前记录随后已重新核对，请核对当前状态后再决定发放。'
        : '当前记录随后已有更新，请核对当前状态后再继续。'
  return `原发放提交因${changedSource}变化未执行，原实发输入仍保留。${currentState}`
}
