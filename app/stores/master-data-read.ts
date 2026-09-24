import type { LookupOption } from '~/lib/kit/lookup'
import type { MasterDataOwnerType } from '~/lib/master-data/forms'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { select } from '~/lib/db/connection'
import {
  hiddenCtesFor,
  selectVisibleSql,
  visibleCond,
} from '~/lib/db/soft-delete'
import { parseJsonColumn } from '~/lib/util/json'

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
  const loadedByKind = shallowRef<Partial<Record<MasterDataListKind, boolean>>>({})
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
    loadedByKind.value = { ...loadedByKind.value, [kind]: true }
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
            aliases: parseJsonColumn<string[]>(row.aliases, []),
            taxNo: row.tax_no,
            contact: row.contact,
            contactPhone: row.contact_phone,
            status: row.status,
            updatedAt: row.updated_at,
          })))
          break
        }
        case 'crew': {
          const rows = await select<Record<string, unknown>>(`
            ${hiddenCtesFor('crews', 'workers', 'unit_assignments', 'wage_statements', 'projects')},
            crew_project_refs AS (
              SELECT worker.crew_id, worker.current_project_id AS project_id
              FROM workers AS worker
              WHERE ${visibleCond('workers', 'worker')}
                AND worker.crew_id IS NOT NULL
                AND worker.current_project_id IS NOT NULL

              UNION

              SELECT assignment.crew_id, building.project_id
              FROM unit_assignments AS assignment
              JOIN units AS unit ON unit.id = assignment.unit_id
              JOIN floors AS floor ON floor.id = unit.floor_id
              JOIN buildings AS building ON building.id = floor.building_id
              WHERE ${visibleCond('unit_assignments', 'assignment')}
                AND assignment.crew_id IS NOT NULL

              UNION

              SELECT statement.crew_id, statement.project_id
              FROM wage_statements AS statement
              WHERE ${visibleCond('wage_statements', 'statement')}
                AND statement.crew_id IS NOT NULL
                AND statement.project_id IS NOT NULL
            ),
            crew_project_stats AS (
              SELECT
                reference.crew_id,
                COUNT(DISTINCT project.id) AS project_count,
                GROUP_CONCAT(DISTINCT project.name) AS project_names
              FROM crew_project_refs AS reference
              JOIN projects AS project
                ON project.id = reference.project_id
               AND ${visibleCond('projects', 'project')}
              GROUP BY reference.crew_id
            )
            SELECT
              crew.*,
              COUNT(DISTINCT member.id) AS member_count,
              COUNT(DISTINCT CASE
                WHEN member.project_status = '在场' THEN member.id
              END) AS active_member_count,
              COALESCE(project_stats.project_count, 0) AS project_count,
              COALESCE(project_stats.project_names, '') AS project_names
            FROM crews AS crew
            LEFT JOIN workers AS member
              ON member.crew_id = crew.id
             AND ${visibleCond('workers', 'member')}
            LEFT JOIN crew_project_stats AS project_stats
              ON project_stats.crew_id = crew.id
            WHERE ${visibleCond('crews', 'crew')}
            GROUP BY crew.id
            ORDER BY crew.updated_at DESC, crew.name
          `)
          setRows(kind, rows.map(row => ({
            id: row.id as string,
            name: row.name as string,
            trade: row.trade,
            contactName: row.contact_name,
            contactPhone: row.contact_phone,
            memberCount: Number(row.member_count ?? 0),
            activeMemberCount: Number(row.active_member_count ?? 0),
            projectCount: Number(row.project_count ?? 0),
            projectNames: String(row.project_names ?? '')
              .split(',')
              .map(value => value.trim())
              .filter(Boolean),
            note: row.note,
            status: row.status,
            updatedAt: row.updated_at,
          })))
          break
        }
        case 'worker': {
          const rows = await select<Record<string, unknown>>(`
            ${hiddenCtesFor('workers', 'projects')}
            SELECT
              worker.*,
              crew.name AS crew_name,
              project.name AS project_name
            FROM workers AS worker
            LEFT JOIN crews AS crew ON crew.id = worker.crew_id
              AND ${visibleCond('crews', 'crew')}
            LEFT JOIN projects AS project ON project.id = worker.current_project_id
              AND ${visibleCond('projects', 'project')}
            WHERE ${visibleCond('workers', 'worker')}
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
            idCard: row.id_card,
            entryDate: row.entry_date,
            exitDate: row.exit_date,
            safetyEducation: row.safety_education === 1,
            safetyEducationLabel: row.safety_education === 1 ? '已完成' : '未完成',
            status: row.status,
            updatedAt: row.updated_at,
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
            updatedAt: row.updated_at,
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
    loadedByKind: readonly(loadedByKind),
    loadingByKind: readonly(loadingByKind),
    load,
    searchCustomers,
    searchProjects,
    searchCrews,
  }
})
