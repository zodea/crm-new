import type { PayrollWorkbenchOptions, WageStatementFilter, WageStatementStatus } from './statements'

type QueryValue = string | null | undefined | readonly (string | null)[]
type QueryLike = Record<string, QueryValue>

function firstQueryValue(value: QueryValue): string {
  if (Array.isArray(value))
    return value.find(item => typeof item === 'string') ?? ''
  return typeof value === 'string' ? value : ''
}

function normalizeStatus(value: string): WageStatementStatus | '' | WageStatementStatus[] {
  if (value.startsWith('[')) {
    try {
      const items: unknown = JSON.parse(value)
      if (Array.isArray(items))
        return [...new Set(items.filter((item): item is WageStatementStatus => item === 'draft' || item === 'checked' || item === 'released'))]
    }
    catch { return '' }
  }
  return value === 'draft' || value === 'checked' || value === 'released'
    ? value
    : ''
}

export function payrollFiltersFromQuery(
  query: QueryLike,
  fallback: WageStatementFilter = {},
): WageStatementFilter {
  const month = firstQueryValue(query.month)
  // 来源链接省略空筛选；只有完全没有来源键时才沿用页签缓存。
  const hasSourceContext = ['project', 'month', 'crew', 'status'].some(key => Object.hasOwn(query, key))
  return {
    projectId: hasSourceContext ? firstQueryValue(query.project) : fallback.projectId || '',
    month: /^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) ? month : fallback.month || '',
    crewId: hasSourceContext ? firstQueryValue(query.crew) : fallback.crewId || '',
    status: hasSourceContext ? normalizeStatus(firstQueryValue(query.status)) : fallback.status || '',
  }
}

/** 来源只恢复当前目录中有效的身份；空班组始终表示全部班组。 */
export function payrollScopeFromOptions(
  scope: Pick<WageStatementFilter, 'projectId' | 'crewId'>,
  options: Pick<PayrollWorkbenchOptions, 'projects' | 'crews'>,
): { projectId: string, crewId: string } {
  return {
    projectId: options.projects.find(project => project.id === scope.projectId)?.id
      ?? options.projects[0]?.id ?? '',
    crewId: options.crews.find(crew => crew.id === scope.crewId)?.id ?? '',
  }
}
