import type { LookupOption } from '~/lib/kit/lookup'
import type { MasterDataOwnerType } from '~/lib/master-data/forms'
import { defineStore } from 'pinia'
import { select } from '~/lib/db/connection'
import {
  selectVisibleSql,
} from '~/lib/db/soft-delete'

export type MasterDataListKind = Extract<
  MasterDataOwnerType,
  'customer' | 'crew' | 'worker' | 'target_cost'
>

type LookupTable = 'customers' | 'projects' | 'crews'

export const useMasterDataReadStore = defineStore('master-data-read', () => {
  async function searchLookup(
    table: LookupTable,
    keyword: string,
    includeAliases = false,
  ): Promise<LookupOption[]> {
    const pattern = `%${keyword.trim()}%`
    const aliasClause = includeAliases ? 'OR aliases LIKE ? OR tax_no LIKE ?' : ''
    const params = includeAliases ? [pattern, pattern, pattern] : [pattern]
    const rows = await select<{ id: string, name: string }>(
      selectVisibleSql(
        table,
        `AND (name LIKE ? ${aliasClause}) ORDER BY name LIMIT 50`,
      ),
      params,
    )
    return rows.map(row => ({ id: row.id, label: row.name }))
  }

  const searchCustomers = (keyword: string) => searchLookup('customers', keyword, true)
  const searchProjects = (keyword: string) => searchLookup('projects', keyword)
  const searchCrews = (keyword: string) => searchLookup('crews', keyword)

  return {
    searchCustomers,
    searchProjects,
    searchCrews,
  }
})
