export interface ProjectListFilterable {
  name: string
  code: string
  address: string
  contractName: string
  developer: string
  manager: string
  status: string
}

export interface ProjectListFilters {
  search: string
  status: string
}

export interface ProjectColumnFilter {
  field: string
  values: unknown[]
}

const SEARCH_FIELDS = ['name', 'code', 'address', 'contractName', 'developer', 'manager'] as const

export function filterProjects<T extends ProjectListFilterable>(
  rows: readonly T[],
  filters: ProjectListFilters,
): T[] {
  const query = filters.search.trim().toLocaleLowerCase('zh-CN')

  return rows.filter((project) => {
    if (filters.status !== 'all' && project.status !== filters.status)
      return false
    if (!query)
      return true

    return SEARCH_FIELDS.some(field => project[field].toLocaleLowerCase('zh-CN').includes(query))
  })
}

export function filterProjectColumns<T extends object>(
  rows: readonly T[],
  filters: readonly ProjectColumnFilter[],
): T[] {
  return rows.filter(row => filters.every((filter) => {
    if (!filter.values.length)
      return true
    return filter.values.includes((row as Record<string, unknown>)[filter.field])
  }))
}
