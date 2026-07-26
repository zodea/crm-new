import type { LookupOption } from '~/lib/kit/lookup'
import type { MasterDataOwnerType } from '~/lib/master-data/forms'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { select } from '~/lib/db/connection'
import { selectVisibleSql } from '~/lib/db/soft-delete'

export type MasterDataListKind = Extract<
  MasterDataOwnerType,
  'customer' | 'crew' | 'worker' | 'target_cost'
>

export type MasterDataListRow = Record<string, unknown> & {
  id: string
  name: string
}

type LookupTable = 'customers' | 'projects' | 'crews'

const EMPTY_ROWS: Record<MasterDataListKind, MasterDataListRow[]> = {
  customer: [],
  crew: [],
  worker: [],
  target_cost: [],
}

export const useMasterDataReadStore = defineStore('master-data-read', () => {
  const rowsByKind = shallowRef<Record<MasterDataListKind, MasterDataListRow[]>>({
    ...EMPTY_ROWS,
  })
  const loadingByKind = shallowRef<Record<MasterDataListKind, boolean>>({
    customer: false,
    crew: false,
    worker: false,
    target_cost: false,
  })

  function setRows(kind: MasterDataListKind, rows: MasterDataListRow[]) {
    rowsByKind.value = {
      ...rowsByKind.value,
      [kind]: rows,
    }
  }

  function setLoading(kind: MasterDataListKind, loading: boolean) {
    loadingByKind.value = {
      ...loadingByKind.value,
      [kind]: loading,
    }
  }

  async function load(kind: MasterDataListKind) {
    setLoading(kind, true)
    try {
      switch (kind) {
        case 'customer': {
          const rows = await select<Record<string, unknown>>(
            selectVisibleSql('customers', 'ORDER BY created_at DESC'),
          )
          setRows(kind, rows.map(row => ({
            id: row.id as string,
            name: row.name as string,
            aliases: row.aliases,
            taxNo: row.tax_no,
            contact: row.contact,
            contactPhone: row.contact_phone,
            status: row.status,
          })))
          break
        }
        case 'crew': {
          const rows = await select<Record<string, unknown>>(
            selectVisibleSql('crews', 'ORDER BY created_at DESC'),
          )
          setRows(kind, rows.map(row => ({
            id: row.id as string,
            name: row.name as string,
            trade: row.trade,
            contactName: row.contact_name,
            contactPhone: row.contact_phone,
            status: row.status,
          })))
          break
        }
        case 'worker': {
          const visibleWorkers = selectVisibleSql('workers')
          const rows = await select<Record<string, unknown>>(`
            SELECT
              worker.*,
              crew.name AS crew_name,
              project.name AS project_name
            FROM (${visibleWorkers}) AS worker
            LEFT JOIN crews AS crew ON crew.id = worker.crew_id
            LEFT JOIN projects AS project ON project.id = worker.current_project_id
            ORDER BY worker.created_at DESC
          `)
          setRows(kind, rows.map(row => ({
            id: row.id as string,
            name: row.name as string,
            trade: row.trade,
            crewName: row.crew_name,
            projectName: row.project_name,
            projectStatus: row.project_status,
            phone: row.phone,
          })))
          break
        }
        case 'target_cost': {
          const visibleTargets = selectVisibleSql('target_costs')
          const rows = await select<Record<string, unknown>>(`
            SELECT target.*, project.name AS project_name
            FROM (${visibleTargets}) AS target
            LEFT JOIN projects AS project ON project.id = target.project_id
            ORDER BY target.created_at DESC
          `)
          setRows(kind, rows.map(row => ({
            id: row.id as string,
            name: row.name as string,
            projectName: row.project_name,
            isBaselineLabel: row.is_baseline === 1 ? '是' : '否',
            taxInclusiveTotal: row.tax_inclusive_total,
            signedContractSum: row.signed_contract_sum,
            status: row.status,
          })))
          break
        }
      }
      return rowsByKind.value[kind]
    }
    finally {
      setLoading(kind, false)
    }
  }

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
    rowsByKind: readonly(rowsByKind),
    loadingByKind: readonly(loadingByKind),
    load,
    searchCustomers,
    searchProjects,
    searchCrews,
  }
})
