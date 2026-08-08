import * as XLSX from 'xlsx'
import { select } from '~/lib/db/connection'
import { selectVisibleSql } from '~/lib/db/soft-delete'
import { loadFileRefContent } from '~/lib/forms/file-refs'
import { PROJECT_PHASES } from '~/lib/project/phases'

export type ProjectArchiveSensitivity = 'normal' | 'sensitive'

export interface ProjectArchiveFile {
  id: string
  ownerType: string
  ownerId: string
  fileName: string
  fileSize: number
  mimeType: string
  category: string
  uploader: string
  uploadedAt: string
  sourceLabel: string
  folderPath: readonly string[]
  archivePath: string
  sensitivity: ProjectArchiveSensitivity
  hasPayload: boolean
  missingReason?: string
}

export interface ProjectArchiveFolder {
  key: string
  path: readonly string[]
  label: string
  sensitive?: boolean
}

export interface ProjectArchiveTreeNode {
  key: string
  label: string
  kind: 'folder' | 'file'
  children?: ProjectArchiveTreeNode[]
  file?: ProjectArchiveFile
  sensitive?: boolean
  empty?: boolean
}

export interface ProjectArchiveProject {
  id: string
  name: string
  code: string
  status: string
  manager: string
  developer: string
}

export interface ProjectArchiveSnapshot {
  project: ProjectArchiveProject
  folders: readonly ProjectArchiveFolder[]
  files: readonly ProjectArchiveFile[]
  tree: readonly ProjectArchiveTreeNode[]
}

export interface ProjectArchiveZipFile {
  path: string
  data: Uint8Array
  mimeType?: string
}

export interface ProjectArchiveZipOptions {
  selectedFileIds: ReadonlySet<string>
  exportedAt?: string
  loadContent?: (file: ProjectArchiveFile) => Promise<Uint8Array | null>
}

interface FileRefRow {
  id: string
  owner_type: string
  owner_id: string
  file_name: string | null
  file_size: number | null
  mime_type: string | null
  category: string | null
  uploader: string | null
  uploaded_at: string | null
}

interface RelatedRecord {
  [key: string]: unknown
  id: string
  name?: string | null
  supplier_id?: string | null
  supplierId?: string | null
  project_supplier_id?: string | null
  contract_id?: string | null
  project_id?: string | null
  crew_id?: string | null
  worker_id?: string | null
  leader_worker_id?: string | null
  phase_index?: number | null
  task_index?: number | null
  title?: string | null
  category?: string | null
}

interface OwnerContext {
  type: string
  id: string
  label: string
  supplierId?: string
  crewId?: string
  workerId?: string
  folderPath: readonly string[]
}

interface ArchiveBuildContext {
  project: ProjectArchiveProject
  tasks: Map<string, { phaseIndex: number, taskIndex: number, title: string }>
  suppliers: Map<string, string>
  projectSuppliers: Map<string, { supplierId: string, label: string }>
  contracts: Map<string, RelatedRecord>
  constructionContracts: Map<string, RelatedRecord>
  expenditureContracts: Map<string, RelatedRecord>
  settlements: Map<string, RelatedRecord>
  crews: Map<string, string>
  workers: Map<string, { name: string, crewId: string | null }>
  owners: Map<string, OwnerContext>
}

const ROOT_PROJECT = '01_项目信息与工程档案'
const ROOT_SUPPLIER = '02_分供方'
const ROOT_CREW = '03_班组与工人'
const ROOT_UNSORTED = '99_待归类'

const SENSITIVE_CATEGORIES = new Set([
  '身份证',
  '身份证件',
  '银行卡',
  '银行账户',
  '个人证照',
  '证照原件',
  '敏感原件',
])

const SUPPLIER_FOLDERS: Record<string, string> = {
  supplier: '01_公司资料',
  supplier_credential: '01_公司资料/01_证照原件',
  project_supplier: '07_项目合作资料',
  contract: '02_合同与补充协议',
  contract_supplement: '02_合同与补充协议',
  construction_contract: '02_合同与补充协议',
  expenditure_contract: '02_合同与补充协议',
  payment_application: '03_请款与发票',
  invoice: '03_请款与发票',
  payment_record: '04_付款凭证',
  settlement: '05_结算',
  expenditure_settlement: '05_结算',
  delivery_record: '06_到货与物资',
}

const PROJECT_OWNER_FOLDERS: Record<string, string> = {
  project_acceptance: '08_竣工验收与保修',
  owner_final_settlement: '08_竣工验收与保修',
  owner_penalty: '09_其他项目单据',
  subcontract_change_order: '09_其他项目单据',
  boq_change_order: '09_其他项目单据',
  monthly_statement: '09_其他项目单据',
  target_cost: '09_其他项目单据',
  penalty_record: '09_其他项目单据',
  material_requisition: '07_物资单据',
  material_arrival: '07_物资单据',
  owner_material_control: '07_物资单据',
  owner_material_requisition: '07_物资单据',
  owner_material_arrival: '07_物资单据',
  owner_material_use: '07_物资单据',
  owner_material_direct: '07_物资单据',
  invoice_application: '03_请款与发票',
  receipt_registration: '03_请款与发票',
  current_transaction: '10_往来款',
  expense_reimbursement: '10_往来款',
}

const OWNER_SOURCE_TABLES = [
  ['contract_supplement', 'contract_supplements', 'contract_id'],
  ['settlement', 'settlements', 'project_supplier_id'],
] as const

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function number(value: unknown): number {
  return Math.max(Number(value) || 0, 0)
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function placeholders(count: number): string {
  return Array.from({ length: count }).fill('?').join(', ')
}

async function selectProjectRows<T extends object>(
  table: string,
  projectId: string,
  projectColumn = 'project_id',
): Promise<T[]> {
  return select<T>(
    selectVisibleSql(table, `AND ${projectColumn} = ?`),
    [projectId],
  )
}

async function selectVisibleByIds<T extends object>(
  table: string,
  ids: readonly string[],
): Promise<T[]> {
  const filtered = unique(ids)
  if (!filtered.length)
    return []
  return select<T>(
    selectVisibleSql(table, `AND id IN (${placeholders(filtered.length)})`),
    filtered,
  )
}

export function sanitizeSegment(value: unknown, fallback = '未命名'): string {
  const cleaned = [...text(value)]
    .map(character => character.codePointAt(0)! < 0x20 ? '-' : character)
    .join('')
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/^\.+/, '')
    .replace(/[.\s]+$/g, '')
    .slice(0, 120)
  if (!cleaned)
    return fallback
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(cleaned))
    return `_${cleaned}`
  return cleaned
}

export function archivePath(...segments: readonly string[]): string {
  return segments.flatMap(segment => segment.split('/')).map(segment => sanitizeSegment(segment)).join('/')
}

function folderKey(path: readonly string[]): string {
  return `folder:${path.join('/')}`
}

function fileKey(file: ProjectArchiveFile): string {
  return `file:${file.id}`
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function phaseFolder(phaseIndex: number, phaseName: string): string {
  return `${String(phaseIndex + 2).padStart(2, '0')}_${sanitizeSegment(phaseName)}`
}

function isSensitive(ownerType: string, category: string): boolean {
  if (ownerType === 'supplier_credential' || ownerType === 'worker')
    return true
  return SENSITIVE_CATEGORIES.has(category)
}

function ownerMapKey(ownerType: string, ownerId: string): string {
  return `${ownerType}:${ownerId}`
}

function addOwner(context: ArchiveBuildContext, owner: OwnerContext): void {
  context.owners.set(ownerMapKey(owner.type, owner.id), owner)
}

function ownerFolderForSupplier(
  ownerType: string,
  supplierId: string,
  supplierName: string,
): string[] {
  const suffix = SUPPLIER_FOLDERS[ownerType] ?? '08_其他项目资料'
  return [ROOT_SUPPLIER, '02_乙供材', sanitizeSegment(supplierName || supplierId), ...suffix.split('/')]
}

function buildProjectFolders(
  tasks: Map<string, { phaseIndex: number, taskIndex: number, title: string }>,
  suppliers: Map<string, string>,
  projectSuppliers: Map<string, { supplierId: string, label: string }>,
  crews: Map<string, string>,
  workers: Map<string, { name: string, crewId: string | null }>,
): ProjectArchiveFolder[] {
  const folders: ProjectArchiveFolder[] = [
    { key: 'project-manifest', path: [ROOT_PROJECT, '00_档案说明与清单'], label: '档案说明与清单' },
    { key: 'project-basic', path: [ROOT_PROJECT, '01_项目基本信息'], label: '项目基本信息' },
    { key: 'project-other', path: [ROOT_PROJECT, '09_其他项目单据'], label: '其他项目单据' },
    { key: 'supplier-root', path: [ROOT_SUPPLIER], label: '分供方' },
    { key: 'supplier-material-root', path: [ROOT_SUPPLIER, '02_乙供材'], label: '乙供材分供方' },
    { key: 'crew-root', path: [ROOT_CREW], label: '班组与工人' },
    { key: 'unsorted', path: [ROOT_UNSORTED], label: '无法确定业务归属的文件' },
  ]
  for (const [phaseIndex, phase] of PROJECT_PHASES.entries()) {
    folders.push({
      key: `phase:${phaseIndex}`,
      path: [ROOT_PROJECT, phaseFolder(phaseIndex, phase.name)],
      label: phase.name,
    })
  }
  for (const [taskId, task] of tasks) {
    const phaseName = PROJECT_PHASES[task.phaseIndex]?.name ?? `阶段${task.phaseIndex + 1}`
    const path = [ROOT_PROJECT, phaseFolder(task.phaseIndex, phaseName), `${String(task.taskIndex + 1).padStart(2, '0')}_${sanitizeSegment(task.title)}`]
    folders.push({ key: `task:${taskId}`, path, label: task.title })
  }
  for (const [supplierId, supplierName] of suppliers) {
    const relationship = [...projectSuppliers.values()].find(item => item.supplierId === supplierId)
    const supplierLabel = relationship?.label || supplierName || supplierId
    folders.push({
      key: `supplier:${supplierId}`,
      path: ownerFolderForSupplier('supplier', supplierId, supplierLabel),
      label: supplierLabel,
    })
  }
  for (const [crewId, crewName] of crews) {
    folders.push({
      key: `crew:${crewId}`,
      path: [ROOT_CREW, sanitizeSegment(crewName || crewId), '00_班组资料'],
      label: crewName || crewId,
    })
  }
  for (const [workerId, worker] of workers) {
    const crewName = worker.crewId ? crews.get(worker.crewId) || worker.crewId : '未分组'
    folders.push({
      key: `worker:${workerId}`,
      path: [ROOT_CREW, sanitizeSegment(crewName), `${sanitizeSegment(worker.name || workerId)}_${sanitizeSegment(workerId)}`, '01_个人资料'],
      label: worker.name || workerId,
      sensitive: true,
    })
  }
  return folders
}

function buildArchiveTree(
  folders: readonly ProjectArchiveFolder[],
  files: readonly ProjectArchiveFile[],
): ProjectArchiveTreeNode[] {
  type MutableFolder = ProjectArchiveTreeNode & { children: ProjectArchiveTreeNode[] }
  const roots = new Map<string, MutableFolder>()

  function ensureFolder(path: readonly string[]): MutableFolder {
    let current: MutableFolder | undefined
    let currentPath: string[] = []
    for (const label of path) {
      currentPath = [...currentPath, label]
      const parent = current?.children ?? [...roots.values()]
      const key = folderKey(currentPath)
      let found = parent.find(node => node.key === key) as MutableFolder | undefined
      if (!found) {
        found = {
          key,
          label,
          kind: 'folder',
          children: [],
        }
        parent.push(found)
      }
      current = found
    }
    return current!
  }

  for (const folder of folders) {
    const node = ensureFolder(folder.path)
    node.empty = true
    node.sensitive = node.sensitive || folder.sensitive
  }
  for (const file of files) {
    const folder = ensureFolder(file.folderPath)
    folder.empty = false
    folder.sensitive = folder.sensitive || file.sensitivity === 'sensitive'
    folder.children.push({
      key: fileKey(file),
      label: file.fileName,
      kind: 'file',
      file,
      sensitive: file.sensitivity === 'sensitive',
      empty: !file.hasPayload,
    })
  }

  function sort(nodes: MutableFolder[]): ProjectArchiveTreeNode[] {
    return nodes
      .sort((left, right) => {
        if (left.kind !== right.kind)
          return left.kind === 'folder' ? -1 : 1
        return compareText(left.label, right.label)
      })
      .map((node) => {
        if (node.kind === 'folder')
          node.children = sort(node.children as MutableFolder[])
        return node
      })
  }

  return sort([...roots.values()])
}

function mapFileRef(row: FileRefRow, owner: OwnerContext, hasPayload: boolean): ProjectArchiveFile {
  const category = text(row.category)
  const sensitivity = isSensitive(row.owner_type, category) ? 'sensitive' : 'normal'
  const folderPath = owner.folderPath
  return {
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    fileName: text(row.file_name) || `${row.id}.bin`,
    fileSize: number(row.file_size),
    mimeType: text(row.mime_type) || 'application/octet-stream',
    category,
    uploader: text(row.uploader),
    uploadedAt: text(row.uploaded_at),
    sourceLabel: owner.label,
    folderPath,
    archivePath: '',
    sensitivity,
    hasPayload,
    missingReason: hasPayload ? undefined : '数据库只有附件元数据，未保存原件正文',
  }
}

function assignArchivePaths(files: readonly ProjectArchiveFile[]): ProjectArchiveFile[] {
  const used = new Set<string>()
  const sorted = [...files].sort((left, right) => {
    const folderOrder = compareText(left.folderPath.join('/'), right.folderPath.join('/'))
    if (folderOrder)
      return folderOrder
    const nameOrder = compareText(left.fileName, right.fileName)
    if (nameOrder)
      return nameOrder
    const timeOrder = compareText(left.uploadedAt, right.uploadedAt)
    return timeOrder || compareText(left.id, right.id)
  })
  return sorted.map((file) => {
    const folder = archivePath(...file.folderPath)
    const rawName = sanitizeSegment(file.fileName, `${file.id}.bin`)
    const dot = rawName.lastIndexOf('.')
    const stem = dot > 0 ? rawName.slice(0, dot) : rawName
    const extension = dot > 0 ? rawName.slice(dot) : ''
    let sequence = 1
    let name = rawName
    let path = `${folder}/${name}`
    while (used.has(path.toLowerCase())) {
      sequence += 1
      name = `${stem} (${sequence})${extension}`
      path = `${folder}/${name}`
    }
    used.add(path.toLowerCase())
    return { ...file, archivePath: path }
  })
}

async function loadWorkerContext(projectId: string): Promise<{
  crewRows: RelatedRecord[]
  workerRows: RelatedRecord[]
}> {
  const [currentWorkers, payrollConfigs, wageStatements, attendance, daywork, units] = await Promise.all([
    select<Record<string, unknown>>(
      `${selectVisibleSql('workers', 'AND current_project_id = ?')}`,
      [projectId],
    ),
    selectProjectRows<RelatedRecord>('payroll_subject_configs', projectId),
    selectProjectRows<RelatedRecord>('wage_statements', projectId),
    selectProjectRows<RelatedRecord>('attendance_records', projectId),
    selectProjectRows<RelatedRecord>('signed_daywork_records', projectId),
    select<Record<string, unknown>>(
      selectVisibleSql(
        'units',
        'AND floor_id IN (SELECT f.id FROM floors f JOIN buildings b ON b.id = f.building_id WHERE b.project_id = ?)',
      ),
      [projectId],
    ),
  ])
  const unitIds = units.map(row => text(row.id)).filter(Boolean)
  const assignments = unitIds.length
    ? await select<Record<string, unknown>>(
        selectVisibleSql('unit_assignments', `AND unit_id IN (${placeholders(unitIds.length)})`),
        unitIds,
      )
    : []
  const workerIds = unique([
    ...currentWorkers.map(row => text(row.id)),
    ...payrollConfigs.map(row => text(row.leader_worker_id)),
    ...wageStatements.flatMap(row => [text(row.leader_worker_id), text(row.worker_id)]),
    ...attendance.map(row => text(row.worker_id)),
    ...daywork.map(row => text(row.worker_id)),
    ...assignments.map(row => text(row.worker_id)),
  ])
  const workerRows = await selectVisibleByIds<RelatedRecord>('workers', workerIds)
  const crewIds = unique([
    ...workerRows.map(row => text(row.crew_id)),
    ...payrollConfigs.map(row => text(row.crew_id)),
    ...wageStatements.map(row => text(row.crew_id)),
    ...attendance.map(row => text(row.crew_id)),
    ...daywork.map(row => text(row.crew_id)),
    ...assignments.map(row => text(row.crew_id)),
  ])
  const crewRows = await selectVisibleByIds<RelatedRecord>('crews', crewIds)
  return { crewRows, workerRows }
}

function sourceRecordOwner(
  context: ArchiveBuildContext,
  ownerType: string,
  row: RelatedRecord,
): OwnerContext | undefined {
  const id = text(row.id)
  if (!id)
    return undefined
  const supplierId = text(row.supplier_id || row.supplierId)
  if (supplierId && context.suppliers.has(supplierId)) {
    const supplierName = context.suppliers.get(supplierId) || supplierId
    return {
      type: ownerType,
      id,
      label: text(row.name) || `${ownerType} ${id}`,
      supplierId,
      folderPath: ownerFolderForSupplier(ownerType, supplierId, supplierName),
    }
  }
  const projectFolder = PROJECT_OWNER_FOLDERS[ownerType]
  if (!projectFolder)
    return undefined
  return {
    type: ownerType,
    id,
    label: text(row.name) || `${ownerType} ${id}`,
    folderPath: [ROOT_PROJECT, projectFolder],
  }
}

export async function loadProjectArchiveSnapshot(projectId: string): Promise<ProjectArchiveSnapshot> {
  const [projectRows, taskRows, projectSupplierRows, contractRows, constructionContractRows, expenditureContractRows] = await Promise.all([
    select<Record<string, unknown>>(
      selectVisibleSql('projects', 'AND id = ?'),
      [projectId],
    ),
    selectProjectRows<RelatedRecord>('phase_tasks', projectId),
    selectProjectRows<RelatedRecord>('project_suppliers', projectId),
    selectProjectRows<RelatedRecord>('contracts', projectId),
    selectProjectRows<RelatedRecord>('construction_contracts', projectId),
    selectProjectRows<RelatedRecord>('expenditure_contracts', projectId),
  ])
  const project = projectRows[0]
  if (!project)
    throw new Error('项目不存在或已被删除')

  const projectSuppliers = new Map(projectSupplierRows.map(row => [
    text(row.id),
    { supplierId: text(row.supplier_id), label: '' },
  ]))
  const supplierIds = unique([
    ...projectSupplierRows.map(row => text(row.supplier_id)),
    ...contractRows.map(row => text(row.supplier_id)),
    ...expenditureContractRows.map(row => text(row.supplier_id)),
  ])
  const [supplierRows, workerContext] = await Promise.all([
    selectVisibleByIds<RelatedRecord>('suppliers', supplierIds),
    loadWorkerContext(projectId),
  ])
  const suppliers = new Map(supplierRows.map(row => [text(row.id), text(row.name) || text(row.id)]))
  for (const relationship of projectSuppliers.values())
    relationship.label = suppliers.get(relationship.supplierId) || relationship.supplierId

  const tasks = new Map(taskRows.map(row => [text(row.id), {
    phaseIndex: Number(row.phase_index) || 0,
    taskIndex: Number(row.task_index) || 0,
    title: text(row.title) || '未命名任务',
  }]))
  const contracts = new Map(contractRows.map(row => [text(row.id), row]))
  const constructionContracts = new Map(constructionContractRows.map(row => [text(row.id), row]))
  const expenditureContracts = new Map(expenditureContractRows.map(row => [text(row.id), row]))
  const settlements = new Map<string, RelatedRecord>()
  const context: ArchiveBuildContext = {
    project: {
      id: projectId,
      name: text(project.name) || projectId,
      code: text(project.code),
      status: text(project.status),
      manager: text(project.manager),
      developer: text(project.developer),
    },
    tasks,
    suppliers,
    projectSuppliers,
    contracts,
    constructionContracts,
    expenditureContracts,
    settlements,
    crews: new Map(workerContext.crewRows.map(row => [text(row.id), text(row.name) || text(row.id)])),
    workers: new Map(workerContext.workerRows.map(row => [text(row.id), {
      name: text(row.name) || text(row.id),
      crewId: text(row.crew_id) || null,
    }])),
    owners: new Map(),
  }

  addOwner(context, {
    type: 'project',
    id: projectId,
    label: context.project.name,
    folderPath: [ROOT_PROJECT, '01_项目基本信息'],
  })
  for (const [taskId, task] of tasks) {
    const phaseName = PROJECT_PHASES[task.phaseIndex]?.name ?? `阶段${task.phaseIndex + 1}`
    addOwner(context, {
      type: 'phase_task',
      id: taskId,
      label: task.title,
      folderPath: [ROOT_PROJECT, phaseFolder(task.phaseIndex, phaseName), `${String(task.taskIndex + 1).padStart(2, '0')}_${sanitizeSegment(task.title)}`],
    })
  }
  for (const [relationshipId, relationship] of projectSuppliers) {
    addOwner(context, {
      type: 'project_supplier',
      id: relationshipId,
      label: relationship.label,
      supplierId: relationship.supplierId,
      folderPath: ownerFolderForSupplier('project_supplier', relationship.supplierId, relationship.label),
    })
  }
  for (const [supplierId, supplierName] of suppliers) {
    addOwner(context, {
      type: 'supplier',
      id: supplierId,
      label: supplierName,
      supplierId,
      folderPath: ownerFolderForSupplier('supplier', supplierId, supplierName),
    })
  }
  for (const [crewId, crewName] of context.crews) {
    addOwner(context, {
      type: 'crew',
      id: crewId,
      label: crewName,
      crewId,
      folderPath: [ROOT_CREW, sanitizeSegment(crewName), '00_班组资料'],
    })
  }
  for (const [workerId, worker] of context.workers) {
    const crewName = worker.crewId ? context.crews.get(worker.crewId) || worker.crewId : '未分组'
    addOwner(context, {
      type: 'worker',
      id: workerId,
      label: worker.name,
      crewId: worker.crewId || undefined,
      workerId,
      folderPath: [ROOT_CREW, sanitizeSegment(crewName), `${sanitizeSegment(worker.name)}_${sanitizeSegment(workerId)}`, '01_个人资料'],
    })
  }

  const relatedTables: Array<[string, string]> = [
    ['invoice', 'invoices'],
    ['payment_application', 'payment_applications'],
    ['payment_record', 'payment_records'],
    ['expenditure_settlement', 'expenditure_settlements'],
    ['delivery_record', 'delivery_records'],
    ['project_acceptance', 'project_acceptances'],
    ['owner_final_settlement', 'owner_final_settlements'],
    ['owner_penalty', 'owner_penalties'],
    ['subcontract_change_order', 'subcontract_change_orders'],
    ['boq_change_order', 'boq_change_orders'],
    ['monthly_statement', 'monthly_statements'],
    ['target_cost', 'target_costs'],
    ['penalty_record', 'penalty_records'],
    ['material_requisition', 'material_requisitions'],
    ['material_arrival', 'material_arrivals'],
    ['owner_material_control', 'owner_material_controls'],
    ['owner_material_requisition', 'owner_material_requisitions'],
    ['owner_material_arrival', 'owner_material_arrivals'],
    ['owner_material_use', 'owner_material_uses'],
    ['owner_material_direct', 'owner_material_directs'],
    ['invoice_application', 'invoice_applications'],
    ['receipt_registration', 'receipt_registrations'],
    ['current_transaction', 'current_transactions'],
    ['expense_reimbursement', 'expense_reimbursements'],
  ]
  const relatedRows = await Promise.all(relatedTables.map(async ([ownerType, table]) => {
    const rows = await selectProjectRows<RelatedRecord>(table, projectId)
    return [ownerType, rows] as const
  }))
  for (const [ownerType, rows] of relatedRows) {
    for (const row of rows) {
      const owner = sourceRecordOwner(context, ownerType, row)
      if (owner)
        addOwner(context, owner)
    }
  }
  for (const [ownerType, table] of OWNER_SOURCE_TABLES) {
    const parentIds = ownerType === 'contract_supplement'
      ? unique([...contracts.keys(), ...constructionContracts.keys()])
      : [...projectSuppliers.keys()]
    if (!parentIds.length)
      continue
    const rows = await select<RelatedRecord>(
      `${selectVisibleSql(table)} AND ${ownerType === 'contract_supplement' ? 'contract_id' : 'project_supplier_id'} IN (${placeholders(parentIds.length)})`,
      parentIds,
    )
    for (const row of rows) {
      if (ownerType === 'settlement')
        settlements.set(text(row.id), row)
      const supplierId = ownerType === 'settlement'
        ? context.projectSuppliers.get(text(row.project_supplier_id))?.supplierId || ''
        : context.contracts.get(text(row.contract_id))?.supplier_id || context.constructionContracts.get(text(row.contract_id))?.supplier_id || ''
      const supplierName = suppliers.get(text(supplierId)) || text(supplierId)
      if (supplierId && supplierName) {
        addOwner(context, {
          type: ownerType,
          id: text(row.id),
          label: text(row.name) || `${ownerType} ${text(row.id)}`,
          supplierId,
          folderPath: ownerFolderForSupplier(ownerType, supplierId, supplierName),
        })
      }
    }
  }
  for (const [contractId, contract] of contracts) {
    const supplierId = text(contract.supplier_id)
    addOwner(context, {
      type: 'contract',
      id: contractId,
      label: text(contract.name) || contractId,
      supplierId: supplierId || undefined,
      folderPath: supplierId && suppliers.has(supplierId)
        ? ownerFolderForSupplier('contract', supplierId, suppliers.get(supplierId) || supplierId)
        : [ROOT_PROJECT, '02_合同资料'],
    })
  }
  for (const [contractId, contract] of expenditureContracts) {
    const supplierId = text(contract.supplier_id)
    addOwner(context, {
      type: 'expenditure_contract',
      id: contractId,
      label: text(contract.name) || contractId,
      supplierId: supplierId || undefined,
      folderPath: supplierId && suppliers.has(supplierId)
        ? ownerFolderForSupplier('expenditure_contract', supplierId, suppliers.get(supplierId) || supplierId)
        : [ROOT_PROJECT, '02_合同资料'],
    })
  }
  for (const [contractId, contract] of constructionContracts) {
    const supplierId = text(contract.supplier_id)
    addOwner(context, {
      type: 'construction_contract',
      id: contractId,
      label: text(contract.name) || contractId,
      supplierId: supplierId || undefined,
      folderPath: supplierId && suppliers.has(supplierId)
        ? ownerFolderForSupplier('construction_contract', supplierId, suppliers.get(supplierId) || supplierId)
        : [ROOT_PROJECT, '02_合同资料'],
    })
  }

  const supplierCredentialRows = supplierIds.length
    ? await select<RelatedRecord>(
        `${selectVisibleSql('supplier_credentials')} AND supplier_id IN (${placeholders(supplierIds.length)})`,
        supplierIds,
      )
    : []
  for (const row of supplierCredentialRows) {
    const supplierId = text(row.supplier_id)
    const supplierName = suppliers.get(supplierId) || supplierId
    addOwner(context, {
      type: 'supplier_credential',
      id: text(row.id),
      label: text(row.name) || text(row.category) || `分供方证照 ${text(row.id)}`,
      supplierId,
      folderPath: ownerFolderForSupplier('supplier_credential', supplierId, supplierName),
    })
  }

  const owners = [...context.owners.values()]
  const ownerIdsByType = new Map<string, Set<string>>()
  for (const owner of owners) {
    const ids = ownerIdsByType.get(owner.type) ?? new Set<string>()
    ids.add(owner.id)
    ownerIdsByType.set(owner.type, ids)
  }
  const fileRows = await select<FileRefRow>(`
    SELECT id, owner_type, owner_id, file_name, file_size, mime_type,
           category, uploader, uploaded_at
    FROM file_refs
    WHERE deleted_at IS NULL
    ORDER BY owner_type ASC, owner_id ASC, uploaded_at ASC, id ASC
  `)
  const selectedRows = fileRows.filter(row => ownerIdsByType.get(row.owner_type)?.has(row.owner_id))
  const payloadIds = selectedRows.length
    ? new Set((await select<{ file_ref_id: string }>(
        `SELECT file_ref_id FROM file_payloads WHERE file_ref_id IN (${placeholders(selectedRows.length)})`,
        selectedRows.map(row => row.id),
      )).map(row => row.file_ref_id))
    : new Set<string>()
  const files = assignArchivePaths(selectedRows.map((row) => {
    const owner = context.owners.get(ownerMapKey(row.owner_type, row.owner_id))!
    return mapFileRef(row, owner, payloadIds.has(row.id))
  }))
  const folders = buildProjectFolders(tasks, suppliers, projectSuppliers, context.crews, context.workers)
  return {
    project: context.project,
    folders,
    files,
    tree: buildArchiveTree(folders, files),
  }
}

export function selectedArchiveFiles(
  snapshot: ProjectArchiveSnapshot,
  selectedFileIds: ReadonlySet<string>,
): ProjectArchiveFile[] {
  return snapshot.files.filter(file => selectedFileIds.has(file.id) && file.hasPayload)
}

function escapeCsv(value: unknown): string {
  const rendered = text(value).replace(/"/g, '""')
  return `"${rendered}"`
}

function toXlsx(rows: readonly Record<string, unknown>[]): Uint8Array {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(rows.length ? [...rows] : [{ 说明: '无记录' }])
  XLSX.utils.book_append_sheet(workbook, sheet, '清单')
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  return output instanceof Uint8Array ? output : new Uint8Array(output)
}

function archiveManifestRows(
  snapshot: ProjectArchiveSnapshot,
  selectedFileIds: ReadonlySet<string>,
): Record<string, unknown>[] {
  return snapshot.files.map(file => ({
    归档路径: file.archivePath,
    原文件名: file.fileName,
    业务归属: file.sourceLabel,
    附件类别: file.category || '未分类',
    文件大小: file.fileSize,
    上传人: file.uploader || '未记录',
    上传时间: file.uploadedAt || '未记录',
    敏感资料: file.sensitivity === 'sensitive' ? '是' : '否',
    本次选择: selectedFileIds.has(file.id) ? '是' : '否',
    导出状态: selectedFileIds.has(file.id) && file.hasPayload ? '已导出' : file.hasPayload ? '未选择' : '原件缺失，仅登记在清单',
    缺失原因: file.missingReason || '',
  }))
}

function archiveDirectoryRows(snapshot: ProjectArchiveSnapshot): Record<string, unknown>[] {
  return snapshot.folders.map(folder => ({
    目录路径: archivePath(...folder.path),
    目录名称: folder.label,
    目录用途: folder.path[0] === ROOT_PROJECT
      ? '项目基本资料、阶段任务和项目业务单据'
      : folder.path[0] === ROOT_SUPPLIER
        ? '项目范围内分供方及合作业务资料'
        : folder.path[0] === ROOT_CREW
          ? '项目范围内班组与工人资料，个人资料默认排除'
          : '无法从真实 owner 关系确定业务归属的资料',
  }))
}

function toBytes(value: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (value instanceof Uint8Array)
    return value
  if (value instanceof ArrayBuffer)
    return new Uint8Array(value)
  return new TextEncoder().encode(value)
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++)
      value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let value = 0xFFFFFFFF
  for (const byte of bytes)
    value = CRC_TABLE[(value ^ byte) & 0xFF]! ^ (value >>> 8)
  return (value ^ 0xFFFFFFFF) >>> 0
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true)
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true)
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

export function createZip(files: readonly ProjectArchiveZipFile[]): Uint8Array {
  const entries = [...files]
    .map(file => ({ ...file, path: archivePath(file.path), data: toBytes(file.data) }))
    .sort((left, right) => compareText(left.path, right.path))
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.path)
    const data = entry.data
    const header = new Uint8Array(30 + name.length)
    const view = new DataView(header.buffer)
    writeU32(view, 0, 0x04034B50)
    writeU16(view, 4, 20)
    writeU16(view, 6, 0x0800)
    writeU16(view, 8, 0)
    writeU16(view, 10, 0)
    writeU16(view, 12, 0)
    writeU32(view, 14, crc32(data))
    writeU32(view, 18, data.length)
    writeU32(view, 22, data.length)
    writeU16(view, 26, name.length)
    writeU16(view, 28, 0)
    header.set(name, 30)
    chunks.push(header, data)

    const centralHeader = new Uint8Array(46 + name.length)
    const centralView = new DataView(centralHeader.buffer)
    writeU32(centralView, 0, 0x02014B50)
    writeU16(centralView, 4, 20)
    writeU16(centralView, 6, 20)
    writeU16(centralView, 8, 0x0800)
    writeU16(centralView, 10, 0)
    writeU16(centralView, 12, 0)
    writeU16(centralView, 14, 0)
    writeU32(centralView, 16, crc32(data))
    writeU32(centralView, 20, data.length)
    writeU32(centralView, 24, data.length)
    writeU16(centralView, 28, name.length)
    writeU16(centralView, 30, 0)
    writeU16(centralView, 32, 0)
    writeU16(centralView, 34, 0)
    writeU16(centralView, 36, 0)
    writeU32(centralView, 38, 0)
    writeU32(centralView, 42, offset)
    centralHeader.set(name, 46)
    central.push(centralHeader)
    offset += header.length + data.length
  }
  const centralBytes = concatBytes(central)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  writeU32(endView, 0, 0x06054B50)
  writeU16(endView, 4, 0)
  writeU16(endView, 6, 0)
  writeU16(endView, 8, entries.length)
  writeU16(endView, 10, entries.length)
  writeU32(endView, 12, centralBytes.length)
  writeU32(endView, 16, offset)
  writeU16(endView, 20, 0)
  return concatBytes([...chunks, centralBytes, end])
}

export async function createProjectArchiveZip(
  snapshot: ProjectArchiveSnapshot,
  options: ProjectArchiveZipOptions,
): Promise<{ data: Uint8Array, exportedFiles: readonly ProjectArchiveFile[], missingFiles: readonly ProjectArchiveFile[] }> {
  const selected = selectedArchiveFiles(snapshot, options.selectedFileIds)
  const selectedWithMissing = snapshot.files.filter(file => options.selectedFileIds.has(file.id))
  const missingFiles = selectedWithMissing.filter(file => !file.hasPayload)
  const loadContent = options.loadContent ?? (async (file: ProjectArchiveFile) => {
    const content = await loadFileRefContent({
      id: file.id,
      ownerType: file.ownerType,
      ownerId: file.ownerId,
    })
    return content?.bytes ?? null
  })
  const zipFiles: ProjectArchiveZipFile[] = []
  const exportedFiles: ProjectArchiveFile[] = []
  for (const file of selected) {
    const content = await loadContent(file)
    if (!content) {
      missingFiles.push(file)
      continue
    }
    zipFiles.push({ path: file.archivePath, data: content, mimeType: file.mimeType })
    exportedFiles.push(file)
  }
  const exportedAt = options.exportedAt ?? new Date().toISOString()
  const manifestRows = archiveManifestRows(snapshot, options.selectedFileIds)
  const directoryRows = archiveDirectoryRows(snapshot)
  const sensitiveCount = selectedWithMissing.filter(file => file.sensitivity === 'sensitive').length
  const explanation = [
    `项目档案包：${snapshot.project.name}`,
    `项目编号：${snapshot.project.code || '未登记'}`,
    `导出时间：${exportedAt}`,
    `本次导出文件：${exportedFiles.length} 个；原件缺失：${missingFiles.length} 个；敏感资料：${sensitiveCount} 个。`,
    '本 ZIP 的写盘完成只代表导出动作完成，不代表项目档案已经齐套；请以文件清单中的缺失和敏感留痕为准。',
  ].join('\n')
  const manifestCsv = [
    [
      '归档路径',
      '原文件名',
      '业务归属',
      '附件类别',
      '文件大小',
      '上传人',
      '上传时间',
      '敏感资料',
      '本次选择',
      '导出状态',
      '缺失原因',
    ].map(escapeCsv).join(','),
    ...manifestRows.map(row => [
      row.归档路径,
      row.原文件名,
      row.业务归属,
      row.附件类别,
      row.文件大小,
      row.上传人,
      row.上传时间,
      row.敏感资料,
      row.本次选择,
      row.导出状态,
      row.缺失原因,
    ].map(escapeCsv).join(',')),
  ].join('\n')
  zipFiles.push(
    { path: `${ROOT_PROJECT}/00_档案说明与清单/导出说明.txt`, data: new TextEncoder().encode(explanation) },
    { path: `${ROOT_PROJECT}/00_档案说明与清单/文件清单.csv`, data: new TextEncoder().encode(manifestCsv) },
    { path: `${ROOT_PROJECT}/00_档案说明与清单/项目档案目录.xlsx`, data: toXlsx(directoryRows) },
    { path: `${ROOT_PROJECT}/00_档案说明与清单/文件清单.xlsx`, data: toXlsx(manifestRows) },
  )
  return {
    data: createZip(zipFiles),
    exportedFiles,
    missingFiles,
  }
}
