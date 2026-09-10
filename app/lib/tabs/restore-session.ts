import type { TabDescriptor, TabRestoreResult, TabRestoreValidator } from './restoration-contract'
import { withTabRestoreDeadline } from './restore-deadline'
import { HOME_KEY } from './tab-machine'

interface Options {
  descriptors: () => readonly TabDescriptor[]
  validate: TabRestoreValidator
  onResolved: (descriptor: TabDescriptor, result: Extract<TabRestoreResult, { state: 'resolved' }>) => void
  onProblem: (descriptor: TabDescriptor, result: Exclude<TabRestoreResult, { state: 'resolved' }>) => void
}

const HOME = { key: HOME_KEY, fullPath: '/' }

/** 按需读取活动项和回退候选；页面切换、关闭和改来源都会使旧响应失效。 */
export function createTabSessionRestorer(options: Options) {
  let active: AbortController | null = null

  function cancel() {
    active?.abort()
    active = null
  }

  async function resolve(preferredKey: string): Promise<{ key: string, fullPath: string } | null> {
    cancel()
    if (preferredKey === HOME_KEY)
      return HOME
    const controller = new AbortController()
    active = controller
    const available = [...options.descriptors()]
    const preferred = available.find(tab => tab.key === preferredKey)
    const candidates = [
      ...(preferred ? [preferred] : []),
      ...available.filter(tab => tab.key !== preferredKey).sort((left, right) => right.updatedAt - left.updatedAt),
    ]
    const stillCurrent = (candidate: TabDescriptor) => {
      const current = options.descriptors().find(tab => tab.key === candidate.key)
      return !controller.signal.aborted && active === controller
        && current?.fullPath === candidate.fullPath && current.origin === candidate.origin
        && current.targetVersion === candidate.targetVersion
    }
    try {
      for (const candidate of candidates) {
        if (!stillCurrent(candidate))
          return null
        let result: TabRestoreResult
        try {
          result = await withTabRestoreDeadline(signal => options.validate(candidate, signal), controller.signal)
        }
        catch (cause) {
          if (!stillCurrent(candidate) || (cause instanceof Error && cause.name === 'AbortError'))
            return null
          result = { state: 'error', message: '页面恢复失败，请重试' }
        }
        if (!stillCurrent(candidate))
          return null
        if (result.state === 'resolved') {
          options.onResolved(candidate, result)
          return { key: candidate.key, fullPath: result.fullPath }
        }
        options.onProblem(candidate, result)
      }
      return controller.signal.aborted ? null : HOME
    }
    finally {
      if (active === controller)
        active = null
    }
  }

  return { resolve, cancel }
}
