import type { ConfirmImpact } from '~/lib/kit/confirm'
import { db } from '~/lib/db/client'
import { execute, select } from '~/lib/db/connection'
import { createSoftDeleteActions, hiddenCtes, logCreate, PARENT_REFS, selectVisibleSql, visibleCond, withUpdateLog } from '~/lib/db/soft-delete'
import { generateId } from '~/lib/util/id'

// 项目直接子表（以 project_id 指向 projects）——从软删层权威登记 PARENT_REFS 反推，
// 不另立硬编码清单（会漂移、漏项）。给 projects 加子表时只需更新 PARENT_REFS，此处自动跟上。
const PROJECT_CHILD_TABLES = Object.entries(PARENT_REFS)
  .filter(([, refs]) => refs.some(r => r.table === 'projects' && r.column === 'project_id'))
  .map(([table]) => table)

// 子表中文标签（PARENT_REFS 无展示名，这是唯一需本地保留的信息；缺省回退表名）。
const TABLE_LABELS: Record<string, string> = {
  invoices: '发票',
  project_suppliers: '分供方关系',
  expenditure_contracts: '支出合同',
  construction_contracts: '施工合同',
  payment_applications: '请款单',
  owner_change_orders: '变更单',
  invoice_applications: '开票申请',
  receipt_registrations: '收货登记',
  current_receipts: '往来收款',
  current_payments: '往来付款',
  payment_records: '付款记录',
  phase_tasks: '阶段任务',
}

/** 数值字段归一：空串 / NaN / nullish → null（避免 v-model.number 清空后把 '' 写进数值列）。 */
function toNum(v: unknown): number | null {
  if (v === '' || v == null)
    return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

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

/**
 * 可写数据列：排除主键、时间戳与审计列。
 * id 由 generateId 生成；created_at/updated_at 由写路径注入 now；
 * created_by/updated_by 是审计列——store 写路径当前不管（沿用旧行为，靠 schema 默认值 ''，
 * 仅 rowToProject 读回），故不进写登记表，避免每次编辑把 updated_by 抹空。
 */
type ProjectWritable = Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>

/** 单列登记项：数据库列名 + 写绑定（字段值 → SQL 占位符实参）+ 读映射（DB 行 → 字段值，按列类型 K 精确定型）。 */
interface ProjectColumn<K extends keyof ProjectWritable> {
  col: string
  toBind: (d: Partial<Project>) => unknown
  fromRow: (row: Record<string, unknown>) => ProjectWritable[K]
}

/**
 * 列登记表（唯一权威源）：INSERT / UPDATE / rowToProject 全部从这里派生列名、占位符、绑定与读映射，
 * 消除「interface / rowToProject / add INSERT / update SET 四处并行维护」造成的列漂移
 * （approval_status / acceptance_date / filing_date 曾在 interface 与 rowToProject 里有、schema 里也有，
 * 却在 add 和 update 两处写路径全漏——新建/编辑项目时这三列永远进不了库，即此类 bug）。
 * 映射类型 `{ [K in keyof ProjectWritable]: … }` 强制键 = 字段名：漏登记某字段直接 typecheck 失败，
 * 新增字段时编译期强制在此补齐，四处自动跟上。
 */
const PROJECT_COLUMNS: { [K in keyof ProjectWritable]: ProjectColumn<K> } = {
  name: { col: 'name', toBind: d => d.name ?? '', fromRow: r => r.name as string },
  contractName: { col: 'contract_name', toBind: d => d.contractName ?? '', fromRow: r => (r.contract_name ?? '') as string },
  code: { col: 'code', toBind: d => d.code ?? '', fromRow: r => (r.code ?? '') as string },
  address: { col: 'address', toBind: d => d.address ?? '', fromRow: r => (r.address ?? '') as string },
  region: { col: 'region', toBind: d => d.region ?? '', fromRow: r => (r.region ?? '') as string },
  type: { col: 'type', toBind: d => d.type ?? '', fromRow: r => (r.type ?? '') as string },
  area: { col: 'area', toBind: d => toNum(d.area), fromRow: r => r.area as number | null },
  contractAmount: { col: 'contract_amount', toBind: d => toNum(d.contractAmount), fromRow: r => r.contract_amount as number | null },
  overview: { col: 'overview', toBind: d => d.overview ?? '', fromRow: r => (r.overview ?? '') as string },
  operationType: { col: 'operation_type', toBind: d => d.operationType ?? '', fromRow: r => (r.operation_type ?? '') as string },
  startDate: { col: 'start_date', toBind: d => d.startDate ?? '', fromRow: r => (r.start_date ?? '') as string },
  plannedEnd: { col: 'planned_end', toBind: d => d.plannedEnd ?? '', fromRow: r => (r.planned_end ?? '') as string },
  actualEnd: { col: 'actual_end', toBind: d => d.actualEnd ?? '', fromRow: r => (r.actual_end ?? '') as string },
  plannedDuration: { col: 'planned_duration', toBind: d => toNum(d.plannedDuration), fromRow: r => r.planned_duration as number | null },
  status: { col: 'status', toBind: d => d.status ?? '筹备中', fromRow: r => (r.status ?? '筹备中') as string },
  developer: { col: 'developer', toBind: d => d.developer ?? '', fromRow: r => (r.developer ?? '') as string },
  developer2: { col: 'developer2', toBind: d => d.developer2 ?? '', fromRow: r => (r.developer2 ?? '') as string },
  supervisor: { col: 'supervisor', toBind: d => d.supervisor ?? '', fromRow: r => (r.supervisor ?? '') as string },
  designer: { col: 'designer', toBind: d => d.designer ?? '', fromRow: r => (r.designer ?? '') as string },
  contractor: { col: 'contractor', toBind: d => d.contractor ?? '', fromRow: r => (r.contractor ?? '') as string },
  manager: { col: 'manager', toBind: d => d.manager ?? '', fromRow: r => (r.manager ?? '') as string },
  managerPhone: { col: 'manager_phone', toBind: d => d.managerPhone ?? '', fromRow: r => (r.manager_phone ?? '') as string },
  siteLeader: { col: 'site_leader', toBind: d => d.siteLeader ?? '', fromRow: r => (r.site_leader ?? '') as string },
  siteLeaderPhone: { col: 'site_leader_phone', toBind: d => d.siteLeaderPhone ?? '', fromRow: r => (r.site_leader_phone ?? '') as string },
  riskLevel: { col: 'risk_level', toBind: d => d.riskLevel ?? '', fromRow: r => (r.risk_level ?? '') as string },
  approvalStatus: { col: 'approval_status', toBind: d => d.approvalStatus ?? '', fromRow: r => (r.approval_status ?? '') as string },
  acceptanceDate: { col: 'acceptance_date', toBind: d => d.acceptanceDate ?? '', fromRow: r => (r.acceptance_date ?? '') as string },
  filingDate: { col: 'filing_date', toBind: d => d.filingDate ?? '', fromRow: r => (r.filing_date ?? '') as string },
  note: { col: 'note', toBind: d => d.note ?? '', fromRow: r => (r.note ?? '') as string },
  description: { col: 'description', toBind: d => d.description ?? '', fromRow: r => (r.description ?? '') as string },
  source: { col: 'source', toBind: d => d.source ?? 'manual', fromRow: r => (r.source ?? 'manual') as string },
}

/** 登记键序（单次求值）：列名清单与绑定值清单都按同一序派生，保证 SQL 占位符与实参一一对齐。 */
const PROJECT_COLUMN_KEYS = Object.keys(PROJECT_COLUMNS) as (keyof ProjectWritable)[]
const PROJECT_COLS = PROJECT_COLUMN_KEYS.map(k => PROJECT_COLUMNS[k].col)

/** 写路径共用 SQL（add 的 INSERT、update 的 SET 均由登记表派生，杜绝列漂移；created_by/updated_by 不写，沿用旧行为）。 */
const INSERT_SQL = `INSERT INTO projects (id, ${PROJECT_COLS.join(', ')}, created_at, updated_at)
       VALUES (?, ${PROJECT_COLS.map(() => '?').join(', ')}, ?, ?)`
const UPDATE_SQL = `UPDATE projects SET ${PROJECT_COLS.map(c => `${c}=?`).join(', ')}, updated_at=? WHERE id=?`

/** 写路径唯一绑定源：按登记键序产出各列 SQL 实参（area/contractAmount/plannedDuration 走 toNum、status/source 带默认值等特殊取值都收在登记表里）。 */
function projectToBindings(data: Partial<Project>): unknown[] {
  return PROJECT_COLUMN_KEYS.map(k => PROJECT_COLUMNS[k].toBind(data))
}

function rowToProject(row: Record<string, unknown>): Project {
  const data: Record<string, unknown> = {}
  for (const k of PROJECT_COLUMN_KEYS)
    data[k] = PROJECT_COLUMNS[k].fromRow(row)
  return {
    id: row.id as string,
    createdBy: (row.created_by ?? '') as string,
    createdAt: (row.created_at ?? '') as string,
    updatedBy: (row.updated_by ?? '') as string,
    updatedAt: (row.updated_at ?? '') as string,
    ...(data as ProjectWritable),
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
    await execute(INSERT_SQL, [id, ...projectToBindings(data), now, now])
    await logCreate(db, 'projects', id)
    await load()
    return id
  }

  /** @returns 操作日志 id;记录不存在/已删时不写入并返回 null(调用方据此提示失败) */
  async function update(id: string, data: Partial<Project>) {
    const now = new Date().toISOString()
    const logId = await withUpdateLog(db, 'projects', id, () => execute(
      UPDATE_SQL,
      [...projectToBindings(data), now, id],
    ))
    await load()
    return logId
  }

  /**
   * 删除前统计各下游子表在「应用可见集」中的未删记录，返回 cascade 杀伤清单（ADR 0003）。
   * 复用软删层可见性口径（hiddenCtes + visibleCond）：只计当前实际可见的记录，与列表页一致，
   * 不把「已因兄弟祖先被删而隐藏」的记录误计入。各子表并行查询。只含 n>0 的项，空数组=无下游。
   */
  async function downstreamImpact(id: string): Promise<ConfirmImpact[]> {
    const counts = await Promise.all(PROJECT_CHILD_TABLES.map(async (table) => {
      const [row] = await select<{ n: number }>(
        `${hiddenCtes(table)} SELECT COUNT(*) AS n FROM "${table}" WHERE ${visibleCond(table)} AND "${table}".project_id = ?`,
        [id],
      )
      return { table, n: row?.n ?? 0 }
    }))
    return counts
      .filter(c => c.n > 0)
      .map(c => ({ label: TABLE_LABELS[c.table] ?? c.table, n: c.n }))
  }

  const { remove, restore, undo } = createSoftDeleteActions(db, 'projects', load)

  return { list: readonly(list), loading: readonly(loading), load, byId, add, update, remove, restore, undo, downstreamImpact }
})
