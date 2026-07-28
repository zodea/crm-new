interface HomeScheduleCoverageInput {
  groups: readonly {
    tasks: readonly {
      hasQty: boolean
      applicableUnits: number | null
    }[]
  }[]
}

export type HomeDashboardViewState
  = | 'loading'
    | 'catalog-empty'
    | 'schedule-empty'
    | 'error'
    | 'ready'

export interface HomeScheduleCoverage {
  isPartial: boolean
  title: string
  description: string
}

export function summarizeHomeScheduleCoverage(
  snapshot: HomeScheduleCoverageInput,
): HomeScheduleCoverage {
  const emptyGroupCount = snapshot.groups.filter(group => group.tasks.length === 0).length
  const missingQuantitySourceCount = snapshot.groups
    .flatMap(group => group.tasks)
    .filter(task => task.hasQty && (task.applicableUnits ?? 0) <= 0)
    .length

  const reasons = [
    emptyGroupCount
      ? `${emptyGroupCount} 个楼栋分组尚未配置工序`
      : '',
    missingQuantitySourceCount
      ? `${missingQuantitySourceCount} 道工程量联动工序尚无适用户完成事实`
      : '',
  ].filter(Boolean)

  if (!reasons.length) {
    return {
      isPartial: false,
      title: '',
      description: '',
    }
  }

  return {
    isPartial: true,
    title: '部分排程数据尚未就绪',
    description: `${reasons.join('；')}。已显示可用进度，缺失部分不按 0 推断。`,
  }
}

interface ResolveHomeProjectSwitchOptions<T> {
  requestedId: string
  confirmedId: string
  load: (projectId: string) => Promise<T>
}

export type HomeProjectSwitchResult<T> = {
  ok: true
  selectedId: string
  value: T
} | {
  ok: false
  selectedId: string
  failedId: string
  error: unknown
}

export async function resolveHomeProjectSwitch<T>({
  requestedId,
  confirmedId,
  load,
}: ResolveHomeProjectSwitchOptions<T>): Promise<HomeProjectSwitchResult<T>> {
  try {
    return {
      ok: true,
      selectedId: requestedId,
      value: await load(requestedId),
    }
  }
  catch (error) {
    return {
      ok: false,
      selectedId: confirmedId,
      failedId: requestedId,
      error,
    }
  }
}
