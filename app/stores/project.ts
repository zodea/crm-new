import { generateId } from '~/lib/util/id'
import { execute, select } from '~/lib/db/connection'
import { db } from '~/lib/db/client'
import { createSoftDeleteActions, logCreate, selectVisibleSql, withUpdateLog } from '~/lib/db/soft-delete'

export interface Project {
  id: string
  name: string
  contractName: string
  code: string
  address: string
  region: string
  type: string
  area: number | null
  contractAmount: number | null
  overview: string
  operationType: string
  startDate: string
  plannedEnd: string
  actualEnd: string
  plannedDuration: number | null
  status: string
  developer: string
  developer2: string
  supervisor: string
  designer: string
  contractor: string
  manager: string
  managerPhone: string
  siteLeader: string
  siteLeaderPhone: string
  riskLevel: string
  approvalStatus: string
  acceptanceDate: string
  filingDate: string
  note: string
  description: string
  source: string
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
}

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    contractName: (row.contract_name ?? '') as string,
    code: (row.code ?? '') as string,
    address: (row.address ?? '') as string,
    region: (row.region ?? '') as string,
    type: (row.type ?? '') as string,
    area: row.area as number | null,
    contractAmount: row.contract_amount as number | null,
    overview: (row.overview ?? '') as string,
    operationType: (row.operation_type ?? '') as string,
    startDate: (row.start_date ?? '') as string,
    plannedEnd: (row.planned_end ?? '') as string,
    actualEnd: (row.actual_end ?? '') as string,
    plannedDuration: row.planned_duration as number | null,
    status: (row.status ?? '筹备中') as string,
    developer: (row.developer ?? '') as string,
    developer2: (row.developer2 ?? '') as string,
    supervisor: (row.supervisor ?? '') as string,
    designer: (row.designer ?? '') as string,
    contractor: (row.contractor ?? '') as string,
    manager: (row.manager ?? '') as string,
    managerPhone: (row.manager_phone ?? '') as string,
    siteLeader: (row.site_leader ?? '') as string,
    siteLeaderPhone: (row.site_leader_phone ?? '') as string,
    riskLevel: (row.risk_level ?? '') as string,
    approvalStatus: (row.approval_status ?? '') as string,
    acceptanceDate: (row.acceptance_date ?? '') as string,
    filingDate: (row.filing_date ?? '') as string,
    note: (row.note ?? '') as string,
    description: (row.description ?? '') as string,
    source: (row.source ?? 'manual') as string,
    createdBy: (row.created_by ?? '') as string,
    createdAt: (row.created_at ?? '') as string,
    updatedBy: (row.updated_by ?? '') as string,
    updatedAt: (row.updated_at ?? '') as string,
  }
}

export const useProjectStore = defineStore('project', () => {
  const list = shallowRef<Project[]>([])
  const loading = shallowRef(false)

  async function load() {
    loading.value = true
    try {
      const rows = await select<Record<string, unknown>>(
        selectVisibleSql('projects', 'ORDER BY created_at DESC'),
      )
      list.value = rows.map(rowToProject)
    }
    finally {
      loading.value = false
    }
  }

  function byId(id: string) {
    return list.value.find(p => p.id === id)
  }

  async function add(data: Partial<Project>) {
    const id = generateId('proj')
    const now = new Date().toISOString()
    await execute(
      `INSERT INTO projects (id, name, contract_name, code, address, region, type, area, contract_amount, overview, operation_type, start_date, planned_end, actual_end, planned_duration, status, developer, developer2, supervisor, designer, contractor, manager, manager_phone, site_leader, site_leader_phone, risk_level, note, description, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, data.name ?? '', data.contractName ?? '', data.code ?? '', data.address ?? '',
        data.region ?? '', data.type ?? '', data.area ?? null, data.contractAmount ?? null,
        data.overview ?? '', data.operationType ?? '',
        data.startDate ?? '', data.plannedEnd ?? '', data.actualEnd ?? '', data.plannedDuration ?? null,
        data.status ?? '筹备中',
        data.developer ?? '', data.developer2 ?? '', data.supervisor ?? '', data.designer ?? '',
        data.contractor ?? '',
        data.manager ?? '', data.managerPhone ?? '', data.siteLeader ?? '', data.siteLeaderPhone ?? '',
        data.riskLevel ?? '', data.note ?? '', data.description ?? '', data.source ?? 'manual',
        now, now,
      ],
    )
    await logCreate(db, 'projects', id)
    await load()
    return id
  }

  /** @returns 操作日志 id;记录不存在/已删时不写入并返回 null(调用方据此提示失败) */
  async function update(id: string, data: Partial<Project>) {
    const now = new Date().toISOString()
    const logId = await withUpdateLog(db, 'projects', id, () => execute(
      `UPDATE projects SET name=?, contract_name=?, code=?, address=?, region=?, type=?, area=?, contract_amount=?, overview=?, operation_type=?, start_date=?, planned_end=?, actual_end=?, planned_duration=?, status=?, developer=?, developer2=?, supervisor=?, designer=?, contractor=?, manager=?, manager_phone=?, site_leader=?, site_leader_phone=?, risk_level=?, note=?, description=?, updated_at=? WHERE id=?`,
      [
        data.name ?? '', data.contractName ?? '', data.code ?? '', data.address ?? '',
        data.region ?? '', data.type ?? '', data.area ?? null, data.contractAmount ?? null,
        data.overview ?? '', data.operationType ?? '',
        data.startDate ?? '', data.plannedEnd ?? '', data.actualEnd ?? '', data.plannedDuration ?? null,
        data.status ?? '筹备中',
        data.developer ?? '', data.developer2 ?? '', data.supervisor ?? '', data.designer ?? '',
        data.contractor ?? '',
        data.manager ?? '', data.managerPhone ?? '', data.siteLeader ?? '', data.siteLeaderPhone ?? '',
        data.riskLevel ?? '', data.note ?? '', data.description ?? '',
        now, id,
      ],
    ))
    await load()
    return logId
  }

  const { remove, restore, undo } = createSoftDeleteActions(db, 'projects', load)

  return { list: readonly(list), loading: readonly(loading), load, byId, add, update, remove, restore, undo }
})
