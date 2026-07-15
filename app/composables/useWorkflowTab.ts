import { isNavigationFailure, NavigationFailureType } from 'vue-router'
import { MAX_TABS } from '~/lib/tabs/tab-machine'

export type OpenWorkflowTabResult
  = | { status: 'blocked' }
    | { status: 'opened', fullPath: string }

export interface WorkflowTabHooks {
  /** 页签预占成功后、导航前执行（如注册 transient 上下文）。 */
  onClaimed?: () => void
  /** 导航失败回滚时执行；预占页签本身由这里负责关闭。 */
  onRollback?: () => void
}

/**
 * 预占式打开工作流页签（导出配置 / 导入映射共用）：
 * 先 open 占位（吃 [[页签导航]] 15 上限，超限 toast 并返回 blocked），
 * 占位成功再导航；导航失败回滚占位与调用方上下文。
 */
export function useWorkflowTab() {
  const router = useRouter()
  const tabsStore = useTabsStore()
  const toast = useToast()

  return async function openWorkflowTab(
    input: { fullPath: string, title: string },
    hooks: WorkflowTabHooks = {},
  ): Promise<OpenWorkflowTabResult> {
    // 确定性路径（如导入映射按实体复用）可能命中已有页签：
    // 回滚时只允许关闭本次调用新建的页签，不得误关复用中的页签。
    const existedBefore = tabsStore.tabs.some(tab => tab.fullPath === input.fullPath)
    const blocked = tabsStore.open(input)
    if (blocked) {
      toast.warning(
        `页签已达上限 ${MAX_TABS} 个`,
        '请先关闭不需要的页签',
      )
      return { status: 'blocked' }
    }

    hooks.onClaimed?.()
    try {
      const failure = await router.push(input.fullPath)
      // cancelled=被更新的导航取代、duplicated=已在目标页：页签均已被接管，
      // 不算失败不回滚；只有守卫中止（aborted）才回滚。
      if (isNavigationFailure(failure, NavigationFailureType.aborted))
        throw failure
    }
    catch (error) {
      hooks.onRollback?.()
      if (!existedBefore)
        tabsStore.close(input.fullPath)
      throw error
    }

    return { status: 'opened', fullPath: input.fullPath }
  }
}
