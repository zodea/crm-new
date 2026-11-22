import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CommandRecoveryDescriptor } from '../../app/lib/forms/command-recovery'
import type { OwnerCommercialDocumentKind, OwnerCommercialDocumentSource } from '../../app/lib/owner-document/central-repository'
import type { OwnerDocumentMigrationCommand, OwnerDocumentMigrationPreview, OwnerDocumentMigrationResult, OwnerDocumentMigrationState, OwnerDocumentReferenceKind } from '../../app/lib/owner-document/production-migration'
import type { BusinessSession } from './business-session'
import type { ProductionStorage } from './production-storage'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { OWNER_DOCUMENT_SOURCE_SQL, PROJECT_PENALTY_SOURCE_SQL } from '../../app/lib/migration/owner-document-source'
import { round2 } from '../../app/lib/util/number'
import { isISODateDTO, isISODateTimeDTO } from '../../app/types/read-model'
import { captureMigrationDomainRows } from './migration-domain-evidence'
import { withVerifiedMigrationSnapshot } from './migration-snapshot'
import { readAuxiliaryContractScopeFacts } from './production-auxiliary-contract-record'
import { readProductionBoqImportedIdentities } from './production-boq-import-evidence'
import { readProductionBoqChanges } from './production-boq-record'
import { readProductionConstructionContractFacts } from './production-construction-contract-sources'
import { listProductionOtherSettlementReferences } from './production-other-settlement-service'
import { assertProductionOwnerDocument, ownerDocumentDigest as digest, ownerDocumentFailure as fail, ownerDocumentKey, parseOwnerDocumentStoredJson, productionOwnerDocumentOwnerType, readProductionOwnerDocumentState } from './production-owner-document-record'
import { PRODUCTION_OWNER_DOCUMENT_HEAD_TABLES } from './production-owner-document-schema'
import { quantityCanonical } from './production-quantity-record'
import { readSubcontractContractScopeFacts } from './production-subcontract-contract-sources'

type Row = Record<string, unknown>
type Session = () => BusinessSession
const tables = { ...PRODUCTION_OWNER_DOCUMENT_HEAD_TABLES, sub_settlement: 'expenditure_settlements' } as const
const text = (value: unknown) => value == null ? '' : String(value)
const nullable = (value: unknown) => value == null ? null : text(value)
function number(value: unknown): number | null {
  if (value == null)
    return null
  if (typeof value !== 'number' || !Number.isFinite(value))
    return fail('validation-failed', '原单据数值不能核对，不能把未知转换为零')
  return value
}
function time(value: unknown, optional = false): string | null {
  if (value == null && optional)
    return null
  const candidate = text(value)
  const normalized = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?$/.test(candidate) ? `${candidate.replace(' ', 'T')}Z` : candidate
  if (!isISODateTimeDTO(normalized))
    return fail('validation-failed', '原商务时间无效，不能用当前时间补造历史')
  return normalized
}
function date(value: unknown): string | null {
  if (value == null || value === '')
    return null
  if (!isISODateDTO(value))
    return fail('validation-failed', '原商务日期不是实际日历日，保留原库不采用')
  return value
}
const owns = (kind: string): kind is keyof typeof tables => Object.hasOwn(tables, kind)
function references(value: unknown, identities: ReadonlySet<string>): boolean {
  if (typeof value === 'string')
    return identities.has(value)
  if (Array.isArray(value))
    return value.some(entry => references(entry, identities))
  return !!value && typeof value === 'object' && Object.values(value).some(entry => references(entry, identities))
}

/** Query-only complete source: presentation never substitutes for the raw original graph. */
export async function readNativeOwnerDocumentSource(native: TransactionDb, proof: { sha256: string, schemaVersion: number }) {
  if (proof.schemaVersion < 47 || proof.schemaVersion > 60)
    return fail('validation-failed', '此 Native 商务存储版本未核验，保留完整原库，不运行初始化或升级')
  const presented = [...await native.select<Row>(OWNER_DOCUMENT_SOURCE_SQL), ...await native.select<Row>(PROJECT_PENALTY_SOURCE_SQL)]
  const documents = presented.filter(row => owns(text(row.kind)))
  const ownerChanges = presented.filter(row => row.kind === 'owner_change')
  const groups: Record<string, Row[]> = {}
  for (const [kind, table] of Object.entries(tables)) {
    const ids = new Set(documents.filter(row => row.kind === kind).map(row => text(row.id)))
    groups[table] = (await native.select<Row>(`SELECT *,CAST(id AS TEXT) AS id FROM ${table} ORDER BY id`)).filter(row => ids.has(text(row.id)))
  }
  for (const [table, parentKey, parentTable] of [
    ['monthly_statement_lines', 'statement_id', 'monthly_statements'],
    ['project_acceptance_lifecycle_events', 'acceptance_id', 'project_acceptances'],
    ['penalty_settlement_deductions', 'penalty_id', 'penalty_records'],
  ]) {
    const ids = new Set(groups[parentTable!]!.map(row => text(row.id)))
    groups[table!] = (await native.select<Row>(`SELECT * FROM ${table} ORDER BY id`)).filter(row => ids.has(text(row[parentKey!])))
  }
  const externalSettlementIds = new Set(groups.penalty_settlement_deductions!.filter(row => !groups.expenditure_settlements!.some(head => head.id === row.settlement_id)).map(row => text(row.settlement_id)))
  const externalSettlements = (await native.select<Row>('SELECT * FROM expenditure_settlements ORDER BY id')).filter(row => externalSettlementIds.has(text(row.id)))
  if (externalSettlements.length !== externalSettlementIds.size || externalSettlements.some(row => !['机械', '其他', '其他支出'].includes(text(row.biz_type))))
    return fail('relationship-mismatch', '原抵扣外部结算祖先缺失或尚无明确Other归属，不能丢行或猜接')
  groups.expenditure_settlements!.push(...externalSettlements)
  const owners = new Map(documents.map(row => [`${productionOwnerDocumentOwnerType(text(row.kind) as OwnerCommercialDocumentKind)}:${row.id}`, row]))
  groups.file_refs = (await native.select<Row>('SELECT * FROM file_refs ORDER BY id')).filter(row => owners.has(`${row.owner_type}:${row.owner_id}`))
  groups.file_payloads = (await native.select<Row>('SELECT * FROM file_payloads ORDER BY file_ref_id')).filter(row => groups.file_refs!.some(file => file.id === row.file_ref_id))
  for (const body of groups.file_payloads) {
    if (body.encoding !== 'base64' || typeof body.content !== 'string' || Buffer.from(body.content, 'base64').toString('base64') !== body.content)
      fail('validation-failed', '原商务原件正文不是完整规范字节，整批拒绝而不丢文件')
  }
  const ownedIds = new Set(Object.values(groups).flatMap(rows => rows.map(row => text(row.id ?? row.file_ref_id))))
  groups.operation_logs = (await native.select<Row>('SELECT * FROM operation_logs ORDER BY id')).filter(row => groups[text(row.table_name)]?.some(source => text(source.id ?? source.file_ref_id) === text(row.record_id)))
  const definitions = await native.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\' ORDER BY name')
  const commandTables = definitions.filter(row => /^owner_document_(?:command|import)/.test(row.name)).map(row => row.name)
  for (const table of commandTables)
    groups[table] = await native.select<Row>(`SELECT * FROM "${table.replaceAll('"', '""')}"`)
  if (definitions.some(row => row.name === 'penalty_rectification_events'))
    groups.penalty_rectification_events = (await native.select<Row>('SELECT * FROM penalty_rectification_events ORDER BY id')).filter(row => ownedIds.has(text(row.penalty_id)))
  // Keep only the original ancestors actually consumed by these heads; unrelated private domains stay outside.
  const masterTables = ['projects', 'customers', 'suppliers', 'crews', 'contracts'] as const
  const masters = Object.fromEntries(await Promise.all(masterTables.map(async table => [table, await native.select<Row>(`SELECT * FROM ${table} ORDER BY id`)]))) as Record<typeof masterTables[number], Row[]>
  const projectIds = new Set([...documents.map(row => text(row.project_id)), ...externalSettlements.map(row => text(row.project_id))])
  groups.projects = masters.projects.filter(row => projectIds.has(text(row.id)))
  groups.customers = masters.customers.filter(row => groups.projects!.some(project => text(project.customer_id) === text(row.id)))
  groups.suppliers = masters.suppliers.filter(row => [...documents, ...externalSettlements].some(document => text(document.supplier_id) === text(row.id)))
  groups.crews = masters.crews.filter(row => documents.some(document => text(document.crew_id) === text(row.id)))
  groups.contracts = masters.contracts.filter(row => Object.values(tables).some(table => groups[table]!.some(head => text(head.contract_id) === text(row.id))))
  const selections = []
  for (const [table, rows] of Object.entries(groups)) {
    const columns = await native.select<{ name: string, pk: number }>(`PRAGMA table_info("${table.replaceAll('"', '""')}")`)
    const primary = columns.filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk).map(column => column.name)
    const keys = table === 'file_payloads' ? ['file_ref_id'] : columns.some(column => column.name === 'id') ? ['id'] : primary
    if (!keys.length)
      fail('validation-failed', '原商务证据表没有可证明稳定键，不能静默遗漏原命令')
    selections.push({ table, keys, ids: rows.map(row => keys.length === 1 ? text(row[keys[0]!]) : JSON.stringify(keys.map(key => text(row[key])))) })
  }
  const raw = await captureMigrationDomainRows(native, selections)
  for (const doc of documents) {
    const raw = groups[tables[text(doc.kind) as keyof typeof tables]]!.find(row => text(row.id) === text(doc.id))
    if (!raw)
      fail('validation-failed', '投影单据没有原始头，拒绝猜接或补建历史')
    doc.rawHead = raw
    // The old presentation SQL coalesces missing amounts. Actual adopted values stay nullable.
    doc.amount = doc.kind === 'owner_report' ? raw.reported_amount ?? raw.total_amount ?? null : doc.kind === 'acceptance' ? raw.contract_estimate ?? null : doc.kind === 'final_settlement' ? raw.settlement_amount : doc.kind === 'sub_change' ? raw.approved_amount : doc.kind === 'sub_settlement' ? raw.total_amount : raw.amount
    number(doc.amount)
  }
  return { ...proof, documents, ownerChanges, groups, raw, masters, commandTables, externalSettlements }
}
type NativeSource = Awaited<ReturnType<typeof readNativeOwnerDocumentSource>>

interface Candidate { kind: OwnerDocumentReferenceKind, id: string, label: string, version: string, value: Row }
async function actualCandidates(tx: TransactionDb, actor: BusinessSession): Promise<Candidate[]> {
  const result: Candidate[] = []
  for (const [kind, table, capability] of [['project', 'projects', 'project:list:read'], ['customer', 'customers', 'customer:list:read'], ['supplier', 'suppliers', 'supplier:list:read'], ['crew', 'crews', 'crew:list:read']] as const) {
    if (!actor.capabilities.includes(capability))
      continue
    const rows = await tx.select<Row>(`SELECT * FROM ${table} ORDER BY id`)
    for (const row of rows) {
      const value = table === 'suppliers' ? parseOwnerDocumentStoredJson<Row>(text(row.draft_json)) : table === 'crews' ? parseOwnerDocumentStoredJson<Row>(text(row.record_json)) : row
      if (row.deleted_at != null || value.deletedAt != null || value.deleted_at != null)
        continue
      result.push({ kind, id: text(row.id), label: text(value.name ?? (value.draft as Row | undefined)?.name), version: digest(row), value: row })
    }
  }
  if (actor.capabilities.includes('construction-contract:read')) {
    const facts = await readProductionConstructionContractFacts(tx, actor)
    for (const row of facts.contracts) {
      const [value] = await tx.select<Row>('SELECT * FROM construction_contract_records WHERE id=?', [row.id])
      result.push({ kind: 'construction', id: row.id, label: `${row.no} ${row.name}`, version: digest(value), value: value! })
    }
  }
  if (actor.capabilities.includes('subcontract-contract:read')) {
    for (const row of (await readSubcontractContractScopeFacts(tx, actor)).filter(row => row.eligible)) {
      const [value] = await tx.select<Row>('SELECT * FROM subcontract_contract_records WHERE id=?', [row.id])
      result.push({ kind: 'subcontract', id: row.id, label: `${row.no} ${row.name}`, version: digest(value), value: value! })
    }
  }
  if (actor.capabilities.includes('auxiliary-contract:read')) {
    for (const row of (await readAuxiliaryContractScopeFacts(tx, actor)).filter(row => row.eligible)) {
      const [value] = await tx.select<Row>('SELECT * FROM auxiliary_contract_records WHERE id=?', [row.id])
      result.push({ kind: 'auxiliary', id: row.id, label: `${row.no} ${row.name}`, version: digest(value), value: value! })
    }
  }
  if (actor.capabilities.includes('other-settlement:read')) {
    for (const row of (await listProductionOtherSettlementReferences(tx, actor)).filter(row => row.deleted_at === null)) {
      const [value] = await tx.select<Row>('SELECT * FROM expenditure_settlements WHERE id=? AND document_owner=\'other\'', [row.id])
      result.push({ kind: 'other-settlement', id: row.id, label: `${row.no} ${row.name}`, version: digest(value), value: value! })
    }
  }
  return result
}
function nativeReferences(source: NativeSource) {
  const refs = new Map<string, { kind: OwnerDocumentReferenceKind, legacyId: string, label: string }>()
  const add = (kind: OwnerDocumentReferenceKind, id: unknown) => {
    if (id == null || id === '')
      return
    const legacyId = text(id)
    const table = ['construction', 'subcontract', 'auxiliary'].includes(kind) ? 'contracts' : `${kind}s` as keyof NativeSource['masters']
    const original = kind === 'other-settlement' ? source.externalSettlements.find(row => text(row.id) === legacyId) : source.masters[table].find(row => text(row.id) === legacyId)
    if (!original)
      fail('relationship-mismatch', '原单据主档或合同关系缺失，不能迁入后按同名补造')
    refs.set(`${kind}:${legacyId}`, { kind, legacyId, label: text(original.name) || legacyId })
  }
  for (const doc of source.documents) {
    const raw = doc.rawHead as Row
    add('project', doc.project_id)
    const project = source.masters.projects.find(row => row.id === doc.project_id)
    add('customer', project?.customer_id)
    add('supplier', doc.supplier_id)
    add('crew', doc.crew_id)
    const contractId = raw.contract_id
    if (contractId != null) {
      const original = source.masters.contracts.find(row => row.id === contractId)
      if (!['施工', '分包', '其他支出'].includes(text(original?.kind)))
        fail('unavailable', '原项目罚扣合同尚无此归属的真实候选，整批保留原图不采用')
      add(original!.kind === '施工' ? 'construction' : original!.kind === '其他支出' ? 'auxiliary' : 'subcontract', contractId)
    }
  }
  for (const row of source.externalSettlements) {
    add('other-settlement', row.id)
    add('project', row.project_id)
    add('supplier', row.supplier_id)
    const original = source.masters.contracts.find(contract => contract.id === row.contract_id)
    if (row.contract_id != null && original?.kind !== '其他支出')
      fail('unavailable', '原Other抵扣结算缺真实其他支出合同祖先，不能按同名合并')
    add('auxiliary', row.contract_id)
  }
  return [...refs.values()]
}

function parseCommand(input: unknown): OwnerDocumentMigrationCommand {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'actorId,commandId,originals,selections,source,workspaceId')
    return fail('validation-failed', '商务迁入必须携完整来源、明确身份映射、原件和原编号')
  const command = input as OwnerDocumentMigrationCommand
  if (!['workspaceId', 'actorId', 'commandId'].every(key => /^[a-z0-9][\w-]{2,79}$/i.test(text(command[key as keyof OwnerDocumentMigrationCommand])))
    || !command.source || !Array.isArray(command.selections) || !Array.isArray(command.originals)) {
    return fail('validation-failed', '商务迁入身份、编号或引用集合不完整')
  }
  if (command.selections.some(row => !row || !['project', 'customer', 'supplier', 'crew', 'construction', 'subcontract', 'auxiliary', 'other-settlement'].includes(row.kind) || !row.legacyId || !row.id || !row.version)
    || new Set(command.selections.map(row => `${row.kind}:${row.legacyId}`)).size !== command.selections.length) {
    return fail('validation-failed', '引用必须逐原身份明确选择真实候选及实际版本，不允许同名猜接')
  }
  if (command.originals.some(row => !row || typeof row.fileId !== 'string' || !row.file || typeof row.file.payloadBase64 !== 'string') || new Set(command.originals.map(row => row.fileId)).size !== command.originals.length)
    return fail('validation-failed', '补传原件必须对应原文件稳定身份，不允许重复或仅元数据')
  return structuredClone(command)
}
function requestSummary(command: OwnerDocumentMigrationCommand) {
  return {
    workspaceId: command.workspaceId,
    actorId: command.actorId,
    commandId: command.commandId,
    sourceSha256: command.source.sha256,
    selections: command.selections,
    originals: command.originals.map(({ fileId, file }) => {
      const { payloadBase64: _body, ...metadata } = file
      return { fileId, file: metadata, sha256: createHash('sha256').update(Buffer.from(file.payloadBase64!, 'base64')).digest('hex') }
    }),
  }
}
function payloadBytes(file: Row, supplied?: OwnerDocumentMigrationCommand['originals'][number]) {
  const body = supplied?.file.payloadBase64 ?? file.content
  if (typeof body !== 'string')
    return null
  const bytes = Buffer.from(body, 'base64')
  if (bytes.toString('base64') !== body || (supplied && supplied.file.fileSize !== bytes.length))
    return fail('validation-failed', '商务原件须是规范完整字节，不能以声明大小替代')
  return bytes
}
async function adoptedBoq(tx: TransactionDb, actor: BusinessSession, source: NativeSource) {
  if (!source.ownerChanges.length && !source.groups.monthly_statement_lines!.some(row => row.boq_line_id != null))
    return []
  const mappings = await readProductionBoqImportedIdentities(tx, source.sha256, actor)
  const changes = await readProductionBoqChanges(tx, undefined, undefined, true)
  for (const original of source.ownerChanges) {
    const mapping = mappings.find(row => row.table === 'boq_change_records' && row.legacyId === original.id)
    if (!mapping || !changes.some(row => row.id === mapping.id))
      fail('unavailable', '此原甲方变洽签尚无同SHA已采用稳定事实，不能复制第二份台账')
  }
  for (const line of source.groups.monthly_statement_lines!) {
    if (line.boq_line_id != null && !mappings.some(row => row.table === 'boq_lines' && row.legacyId === line.boq_line_id))
      fail('unavailable', '历史月报冻结行缺同SHA已确认BOQ身份，不能按旧ID或名称猜接')
  }
  return mappings
}
function mappedRelationships(source: NativeSource, command: OwnerDocumentMigrationCommand, candidates: Candidate[]) {
  const references = nativeReferences(source)
  if (command.selections.length !== references.length)
    return fail('validation-failed', '须完整确认本批实际引用的主档与合同，不部分接管')
  const resolve = (kind: OwnerDocumentReferenceKind, legacy: unknown): Candidate | null => {
    if (legacy == null || legacy === '')
      return null
    const selected = command.selections.find(row => row.kind === kind && row.legacyId === text(legacy))
    const actual = selected && candidates.find(row => row.kind === kind && row.id === selected.id)
    if (!selected || !actual || actual.version !== selected.version)
      return fail('stale-source', '本批实际消费的主档或合同资格已变化，保留完整原图和输入')
    return actual
  }
  for (const original of references)
    resolve(original.kind, original.legacyId)
  return resolve
}
function projectDocument(source: NativeSource, row: Row, mapped: ReturnType<typeof mappedRelationships>, boq: Awaited<ReturnType<typeof adoptedBoq>>): OwnerCommercialDocumentSource {
  const kind = text(row.kind) as keyof typeof tables
  const raw = row.rawHead as Row
  const project = mapped('project', row.project_id)
  const supplier = mapped('supplier', row.supplier_id)
  const crew = mapped('crew', row.crew_id)
  const rawContract = source.masters.contracts.find(contract => contract.id === raw.contract_id)
  const contract = mapped(rawContract?.kind === '施工' ? 'construction' : rawContract?.kind === '其他支出' ? 'auxiliary' : 'subcontract', raw.contract_id)
  const oldProject = source.masters.projects.find(project => project.id === row.project_id)
  const customer = mapped('customer', oldProject?.customer_id)
  if (project && customer && project.value.customer_id !== customer.id)
    return fail('relationship-mismatch', '所选实际项目不属于明确映射的甲方，不能按同名改写原关系')
  if (contract && (contract.value.project_id !== project?.id || (supplier && contract.value.supplier_id !== supplier.id)))
    return fail('relationship-mismatch', '所选实际合同与本批实际项目或分供方关系不同，不能导入后修成一致')
  if (rawContract?.kind === '施工' && customer && contract?.value.customer_id !== customer.id)
    return fail('relationship-mismatch', '所选施工合同不属于明确映射的实际甲方')
  const lines = kind === 'owner_report'
    ? source.groups.monthly_statement_lines!.filter(line => line.statement_id === row.id && line.deleted_at == null).map((line) => {
        const mapping = boq.find(mapping => mapping.table === 'boq_lines' && mapping.legacyId === line.boq_line_id)
        if (!mapping || mapping.projectId !== project?.id || mapping.contractId !== contract?.id)
          return fail('relationship-mismatch', '历史月报BOQ身份与明确映射的项目和施工合同不同')
        return { id: text(line.id), boqLineId: mapping.id, operation: null, itemName: text(line.item_name), unit: text(line.unit), contractQty: null, contractUnitPrice: number(line.unit_price), autoQty: number(line.auto_qty), reportedQty: number(line.reported_qty ?? line.adjusted_qty), auditedQty: number(line.audited_qty), deltaQty: null, newUnitPrice: null, amount: number(line.amount)!, auditedAmount: number(line.audited_amount), note: text(line.note) }
      })
    : []
  const sourceType = kind === 'acceptance' ? 'manual' : kind === 'owner_report' ? 'monthly_statement' : kind === 'project_penalty' ? 'penalty_record' : kind === 'sub_settlement' ? 'expenditure_settlement' : kind === 'sub_change' ? 'subcontract_change_order' : kind === 'final_settlement' ? 'owner_final_settlement' : 'owner_penalty'
  const document: OwnerCommercialDocumentSource = {
    dataOrigin: 'real',
    kind,
    id: text(row.id),
    no: text(row.no),
    name: text(row.name),
    documentType: text(row.document_type),
    projectId: project?.id ?? null,
    projectName: project?.label ?? '',
    projectPermission: 'allowed',
    customerId: customer?.id ?? null,
    customerName: customer?.label ?? '',
    customerPermission: 'allowed',
    supplierId: supplier?.id ?? null,
    supplierName: supplier?.label ?? '',
    supplierPermission: 'allowed',
    crewId: crew?.id ?? null,
    crewName: crew?.label ?? '',
    contractId: contract?.id ?? null,
    contractName: contract?.label ?? '',
    contractNo: text(rawContract?.no),
    contractPermission: 'allowed',
    ...(rawContract?.kind === '其他支出' ? { contractKind: 'other_expense' as const } : {}),
    sourceType,
    sourceId: text(row.id),
    sourceLocked: row.source_locked === 1,
    periodNo: text(row.period_no),
    applicationDate: date(row.application_date),
    approvalDate: date(row.approval_date),
    quantityBasis: nullable(row.quantity_basis),
    quantitySourceVersion: nullable(row.quantity_source_version),
    quantitySourceUpdatedAt: time(row.quantity_source_updated_at, true),
    operatorName: text(row.operator_name),
    submittedAt: time(row.submitted_at, true),
    status: kind === 'owner_report' ? ({ adjusted: 'reported', exported: 'audited' } as Record<string, string>)[text(row.status)] ?? text(row.status) : text(row.status),
    statusNote: text(row.status_note),
    amount: number(row.amount),
    auditedAmount: number(row.audited_amount),
    changedArea: number(row.changed_area),
    actualApprovedPrice: number(row.actual_approved_price),
    taxExclusiveAmount: number(row.tax_exclusive_amount),
    appliedTaxExclusiveAmount: number(row.applied_tax_exclusive_amount),
    note: text(row.note),
    version: Number.isSafeInteger(raw.version) && Number(raw.version) > 0 ? Number(raw.version) : 1,
    createdAt: time(row.created_at)!,
    updatedAt: time(row.updated_at)!,
    lines,
    files: [],
    settlementBasis: text(row.settlement_basis),
    settlementDifferenceNote: text(row.settlement_difference_note),
    deductionNote: text(raw.deduction_note),
    noticeNo: text(row.notice_no),
    penaltyReason: text(row.penalty_reason),
    appealNote: text(row.appeal_note),
    ...(row.deleted_at == null ? {} : { deletedAt: time(row.deleted_at) }),
  }
  if (kind === 'acceptance') {
    const events = source.groups.project_acceptance_lifecycle_events!.filter(event => event.acceptance_id === row.id).map(event => ({ id: text(event.id), action: text(event.action) as 'submit', fromStatus: text(event.from_status) as 'draft', toStatus: text(event.to_status) as 'submitted', actorId: text(event.actor_id), actorName: text(event.actor_name), occurredAt: time(event.occurred_at)!, note: text(event.note) }))
    document.acceptanceLifecycle = { acceptanceOrganization: text(raw.acceptance_organization), acceptancePerson: text(raw.acceptor), acceptanceDate: date(raw.acceptance_date), acceptanceConclusion: text(raw.acceptance_conclusion), warrantyOwner: text(raw.warranty_owner), warrantyStartDate: date(raw.warranty_start_date), warrantyEndDate: date(raw.warranty_end_date), warrantyConfirmationOrganization: nullable(raw.warranty_confirmation_organization), warrantyConfirmationDate: date(raw.warranty_confirmation_date), warrantyConfirmationNote: text(raw.warranty_confirmation_note), events }
  }
  if (kind === 'project_penalty')
    document.penaltyFacts = { deadline: date(raw.deadline), rectificationNote: text(raw.rectification_note), deductionMethod: text(raw.deduction_method), origin: nullable(raw.source) }
  return document
}

export function createProductionOwnerDocumentMigration(storage: ProductionStorage) {
  const active = new Map<string, { fingerprint: string, promise: Promise<OwnerDocumentMigrationResult> }>()
  function authorize(session: Session) {
    const actor = structuredClone(session())
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !actor.capabilities.includes('owner-document:import'))
      return fail('forbidden', '当前身份无本正式商务原库采用权限')
    return actor
  }
  async function run<T>(session: Session, write: boolean, work: (tx: TransactionDb, actor: BusinessSession) => Promise<T>) {
    const actor = authorize(session)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      await assertProductionOwnerDocument(tx, actor)
      const result = await work(tx, actor)
      if (digest(authorize(session)) !== digest(actor))
        return fail('forbidden', '商务采用期间身份或来源变化，原编号与原图保留')
      return result
    })
  }
  async function preflight(input: unknown, session: Session): Promise<OwnerDocumentMigrationPreview> {
    const actor = authorize(session)
    const command = parseCommand(input)
    if (command.workspaceId !== actor.workspaceId || command.actorId !== actor.actorId)
      return fail('forbidden', '原商务采用命令身份不同')
    return withVerifiedMigrationSnapshot(command.source, async (native, proof) => {
      const source = await readNativeOwnerDocumentSource(native, proof)
      return run(session, false, async (tx, actor) => {
        await adoptedBoq(tx, actor, source)
        const candidates = await actualCandidates(tx, actor)
        return { workspaceId: actor.workspaceId, actorId: actor.actorId, sourceSha256: source.sha256, schemaVersion: source.schemaVersion, documents: source.documents.map((row) => {
          const amount = number(row.amount)
          return { kind: text(row.kind) as OwnerCommercialDocumentKind, id: text(row.id), no: text(row.no), status: text(row.status), deleted: row.deleted_at != null, amount: amount === null ? null : round2(amount).toFixed(2) }
        }), references: nativeReferences(source).map(row => ({ ...row, adoptedId: null, candidates: candidates.filter(candidate => candidate.kind === row.kind).map(({ id, label, version }) => ({ id, label, version })) })), originals: source.groups.file_refs!.map(file => ({ fileId: text(file.id), fileName: text(file.file_name), filePath: text(file.file_path), fileSize: number(file.file_size), required: !source.groups.file_payloads!.some(body => body.file_ref_id === file.id) && !!file.file_path, bodyState: source.groups.file_payloads!.some(body => body.file_ref_id === file.id) ? 'embedded' as const : file.file_path ? 'external-required' as const : 'metadata-only' as const })), reusedOwnerChanges: source.ownerChanges.map(row => text(row.id)) }
      })
    })
  }
  async function fixedIntent(tx: TransactionDb, actor: BusinessSession, command: { commandId: string }, action: 'adopt' | 'restore', sourceSha256: string, fingerprint: string, summary: unknown) {
    const key = ownerDocumentKey({ ...actor, commandId: command.commandId })
    if ((await tx.select('SELECT command_id FROM owner_document_import_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', key)).length)
      fail('conflict', '原商务整批编号已封存未应用，迟到请求不能重建')
    const [original] = await tx.select<{ fingerprint: string }>('SELECT fingerprint FROM owner_document_import_intents WHERE workspace_id=? AND actor_id=? AND command_id=?', key)
    if (original && original.fingerprint !== fingerprint)
      fail('conflict', '原商务整批编号已固定其他来源、映射或原件')
    if (!original) {
      if ((await readProductionOwnerDocumentState(tx, actor)).legacyCommandIds.has(command.commandId))
        fail('conflict', '原Native商务编号属于保全来源历史，不能冒用为新的整批命令')
      await tx.execute('INSERT INTO owner_document_import_intents VALUES(?,?,?,?,?,?,?,?)', [...key, action, sourceSha256, fingerprint, quantityCanonical(summary), new Date().toISOString()])
    }
  }
  async function replay(tx: TransactionDb, actor: BusinessSession, commandId: string, fingerprint: string) {
    const key = ownerDocumentKey({ ...actor, commandId })
    if ((await tx.select('SELECT command_id FROM owner_document_import_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', key)).length)
      fail('conflict', '原商务整批编号已明确未应用，不能迟到记账')
    const [receipt] = await tx.select<{ fingerprint: string, result_json: string }>('SELECT * FROM owner_document_import_commands WHERE workspace_id=? AND actor_id=? AND command_id=?', key)
    if (receipt && receipt.fingerprint !== fingerprint)
      fail('conflict', '原商务整批回执属于其他正文')
    return receipt ? parseOwnerDocumentStoredJson<OwnerDocumentMigrationResult>(receipt.result_json) : null
  }
  async function adopt(input: unknown, session: Session): Promise<OwnerDocumentMigrationResult> {
    const actor = authorize(session)
    const command = parseCommand(input)
    if (command.workspaceId !== actor.workspaceId || command.actorId !== actor.actorId)
      return fail('forbidden', '商务采用原身份不同')
    const summary = requestSummary(command)
    const fingerprint = digest(summary)
    const key = quantityCanonical(ownerDocumentKey(command))
    const pending = active.get(key)
    if (pending) {
      if (pending.fingerprint !== fingerprint)
        return fail('conflict', '整批原提交在处理，不能替换原来源或映射')
      return pending.promise
    }
    const promise = withVerifiedMigrationSnapshot(command.source, async (native, proof) => {
      const source = await readNativeOwnerDocumentSource(native, proof)
      if (source.commandTables.some(table => source.groups[table]!.some(row => row.command_id === command.commandId)))
        return fail('conflict', '来源的历史商务命令编号只读保全，不授权当前工作区重新应用')
      await run(session, true, (tx, actor) => fixedIntent(tx, actor, command, 'adopt', source.sha256, fingerprint, summary))
      return run(session, true, async (tx, actor) => {
        const previous = await replay(tx, actor, command.commandId, fingerprint)
        if (previous)
          return previous
        if ((await tx.select('SELECT id FROM owner_document_imports WHERE source_sha256=?', [source.sha256])).length)
          return fail('conflict', '同一完整来源已经采用，不能复制第二份商务图')
        const state = await readProductionOwnerDocumentState(tx, actor)
        const mapped = mappedRelationships(source, command, await actualCandidates(tx, actor))
        const boq = await adoptedBoq(tx, actor, source)
        const documents = source.documents.map(row => projectDocument(source, row, mapped, boq))
        if (!documents.length)
          return fail('validation-failed', '本域没有待采用商务原头，BOQ已采用事实不需要第二次迁入')
        for (const document of documents) {
          const table = tables[document.kind as keyof typeof tables]
          if ((await tx.select(`SELECT id FROM ${table} WHERE id=?`, [document.id])).length)
            return fail('conflict', '原商务稳定ID已有正式事实，不能覆盖或按同名合并')
        }
        const importId = `owner-document-import-${randomUUID()}`
        const now = new Date().toISOString()
        const metadataOnlyFileIds: string[] = []
        const payloadRefs: Row[] = []
        for (const raw of source.groups.file_refs!) {
          const document = documents.find(doc => doc.id === raw.owner_id && productionOwnerDocumentOwnerType(doc.kind) === raw.owner_type)!
          const supplied = command.originals.find(row => row.fileId === raw.id)
          if (supplied && supplied.file.fileName !== raw.file_name)
            return fail('relationship-mismatch', '补传须为原稳定文件与原文件名，不按相似名称替换')
          const body = source.groups.file_payloads!.find(body => body.file_ref_id === raw.id)
          const bytes = payloadBytes(body ?? {}, supplied)
          if (!bytes && raw.file_path)
            return fail('validation-failed', '原路径附件必须补传完整原件，不能擅自声明为历史缺件')
          if (bytes && raw.file_size != null && raw.file_size !== bytes.length)
            return fail('validation-failed', '原附件声明大小与实际完整字节不同')
          if ((await tx.select('SELECT id FROM file_refs WHERE id=?', [raw.id])).length)
            return fail('conflict', '原文件稳定ID已由正式owner使用，保留各自原件不覆盖')
          const file = { id: text(raw.id), fileName: text(raw.file_name), fileSize: bytes?.length ?? number(raw.file_size), mimeType: text(raw.mime_type), category: text(raw.category), uploader: text(raw.uploader), uploadedAt: time(raw.uploaded_at, true), deletedAt: time(raw.deleted_at, true) }
          document.files.push(file)
          const sha256 = bytes ? createHash('sha256').update(bytes).digest('hex') : null
          await tx.execute('INSERT INTO file_refs VALUES(?,?,?,?,?,?,?,?,?,?,?)', [file.id, raw.owner_type, document.id, file.fileName, text(raw.file_path), file.fileSize ?? 0, file.mimeType, file.category, file.uploader, file.uploadedAt ?? '', file.deletedAt])
          if (bytes)
            await tx.execute('INSERT INTO file_payloads VALUES(?,?,?)', [file.id, bytes, sha256])
          else metadataOnlyFileIds.push(file.id)
          await tx.execute('INSERT INTO owner_document_files VALUES(?,?,?,?,?,?)', [file.id, document.kind, document.id, quantityCanonical(file), bytes ? 'embedded' : 'metadata-only', sha256])
          if (body) {
            const column = Buffer.from(text(body.content), 'utf8')
            payloadRefs.push({ fileRefId: file.id, encoding: 'base64', sqliteType: source.raw.rows.file_payloads!.find(row => row.legacyId === file.id)!.columns.content!.sqliteType, sha256, byteLength: bytes!.length, columnSha256: createHash('sha256').update(column).digest('hex'), columnByteLength: column.length })
          }
        }
        if (command.originals.some(file => !source.groups.file_refs!.some(raw => raw.id === file.fileId)))
          return fail('relationship-mismatch', '补传原件超出本批商务owner，不能夹带其他领域文件')
        const rawDomain = { ...source.raw.rows, file_payloads: source.raw.rows.file_payloads!.map(row => ({ ...row, columns: { ...row.columns, content: { sqliteType: row.columns.content!.sqliteType, sharedOriginal: row.legacyId, payloadReference: payloadRefs.find(ref => ref.fileRefId === row.legacyId)! } } })) }
        const mappings = documents.map(document => ({ sourceTable: tables[document.kind as keyof typeof tables], legacyId: document.id, kind: document.kind, documentId: document.id, projectId: document.projectId, contractId: document.contractId }))
        const installed: Record<string, string> = {}
        for (const document of documents) {
          const deletedAt = (document as OwnerCommercialDocumentSource & { deletedAt?: string }).deletedAt ?? null
          const table = tables[document.kind as keyof typeof tables]
          if (document.kind === 'sub_settlement') {
            await tx.execute(`INSERT INTO expenditure_settlements(id,no,name,biz_type,project_id,supplier_id,contract_id,settlement_type,total_amount,settlement_date,settlement_period,deduction_note,status,note,created_by,updated_by,created_at,updated_at,responsible,department,payee_supplier_id,payee_name_snapshot,version,record_json,deleted_at,document_owner)
              VALUES(?,?,?,'分包',?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?,?,?,'business')`, [document.id, document.no, document.name, document.projectId, document.supplierId ?? null, document.contractId, document.documentType, document.amount, document.applicationDate ?? '', document.periodNo, document.deductionNote ?? '', document.status, document.note, actor.actorId, actor.actorId, document.createdAt, document.updatedAt, document.supplierId ?? null, document.supplierName ?? null, document.version, quantityCanonical(document), deletedAt])
          }
          else {
            await tx.execute(`INSERT INTO ${table} VALUES(?,?,?,?,?,?,?,?,?)`, [document.id, document.projectId, document.contractId, document.supplierId ?? null, document.crewId ?? null, document.periodNo || null, quantityCanonical(document), document.version, deletedAt])
          }
          await tx.execute('INSERT INTO owner_document_history VALUES(?,?,?,?,?,?,?,?)', [`owner-import-history-${randomUUID()}`, document.kind, document.id, actor.actorId, command.commandId, null, quantityCanonical(document), now])
          const [row] = await tx.select<Row>(`SELECT * FROM ${table} WHERE id=?`, [document.id])
          installed[`${table}:${document.id}`] = digest(row)
        }
        const importedDeductions = []
        for (const raw of source.groups.penalty_settlement_deductions!) {
          // Soft-deleted source deductions remain original history; they do not become active deductions.
          if (raw.deleted_at != null)
            continue
          const penalty = documents.find(doc => doc.kind === 'project_penalty' && doc.id === raw.penalty_id)
          const settlement = documents.find(doc => doc.kind === 'sub_settlement' && doc.id === raw.settlement_id)
          const external = !settlement ? mapped('other-settlement', raw.settlement_id) : null
          if (!penalty || !settlement) {
            if (!penalty || !external || external.value.project_id !== penalty.projectId || external.value.supplier_id !== penalty.supplierId || external.value.contract_id !== penalty.contractId)
              return fail('unavailable', '原抵扣目标没有本批或显式核验的同父真实Other结算，不猜接或复制第二份头')
          }
          const event = { id: text(raw.id), penaltyId: penalty!.id, settlementId: settlement?.id ?? external!.id, amount: number(raw.amount), actorId: text(raw.actor_id), commandId: text(raw.command_id), occurredAt: time(raw.created_at)!, note: text(raw.note) }
          if (event.amount === null)
            return fail('validation-failed', '原抵扣金额未知，不能补零')
          await tx.execute('INSERT INTO penalty_settlement_deductions VALUES(?,?,?,?)', [event.id, event.penaltyId, event.settlementId, quantityCanonical(event)])
          importedDeductions.push(event)
        }
        const importedRectifications = []
        for (const raw of source.groups.penalty_rectification_events ?? []) {
          const event = raw.record_json ? parseOwnerDocumentStoredJson<Row>(text(raw.record_json)) : raw
          const original = { id: text(event.id), penaltyId: text(event.penaltyId ?? event.penalty_id), actorId: text(event.actorId ?? event.actor_id), occurredAt: time(event.occurredAt ?? event.occurred_at)!, deadline: date(event.deadline), note: text(event.note) }
          await tx.execute('INSERT INTO penalty_rectification_events VALUES(?,?,?)', [original.id, original.penaltyId, quantityCanonical(original)])
          importedRectifications.push(original)
        }
        const installedEvents: Record<string, string> = {}
        for (const [table, events] of [['penalty_settlement_deductions', importedDeductions], ['penalty_rectification_events', importedRectifications]] as const) {
          for (const event of events) {
            const [row] = await tx.select<Row>(`SELECT * FROM ${table} WHERE id=?`, [event.id])
            installedEvents[`${table}:${event.id}`] = digest(row)
          }
        }
        const installedFiles: Record<string, string> = {}
        for (const document of documents) {
          for (const file of document.files) {
            const [row] = await tx.select<Row>('SELECT * FROM file_refs WHERE id=?', [file.id])
            installedFiles[file.id] = digest(row)
          }
        }
        const evidence = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: command.commandId, sourceSha256: source.sha256, schemaVersion: source.schemaVersion, documents, metadataOnlyFileIds, payloadRefs, rawDomain, sourceSchemas: source.raw.schemas, domainEvidenceDigest: digest({ rawDomain, sourceSchemas: source.raw.schemas }), mappings, installed, installedEvents, installedFiles, selections: command.selections, reusedOwnerChanges: source.ownerChanges.map(row => text(row.id)), penaltyDeductions: importedDeductions, penaltyRectifications: importedRectifications, sourceCommandTables: source.commandTables }
        await tx.execute('INSERT INTO owner_document_imports VALUES(?,?,?,?,?,?,?,?)', [importId, actor.workspaceId, actor.actorId, command.commandId, source.sha256, quantityCanonical(evidence), digest(evidence), now])
        for (const mapping of mappings)
          await tx.execute('INSERT INTO owner_document_import_bindings VALUES(?,?,?,?,?,?,?)', [importId, mapping.sourceTable, mapping.legacyId, mapping.kind, mapping.documentId, mapping.projectId, mapping.contractId])
        const migrationKeys = [...new Set([...state.snapshot.migrationKeys, ...documents.filter(document => !(document as { deletedAt?: string }).deletedAt).map(document => `${document.kind}\u001F${document.id}`)])]
        await tx.execute('UPDATE owner_document_revision SET revision=revision+1,metadata_json=? WHERE singleton=1', [quantityCanonical({ migrationKeys, migrationSnapshotFingerprint: state.snapshot.migrationSnapshotFingerprint })])
        const result: OwnerDocumentMigrationResult = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: command.commandId, sourceSha256: source.sha256, importId, documentIds: documents.map(document => document.id), restored: false }
        await tx.execute('INSERT INTO owner_document_import_commands VALUES(?,?,?,?,?,?,?)', [...ownerDocumentKey(command), fingerprint, quantityCanonical(summary), quantityCanonical(result), now])
        await readProductionOwnerDocumentState(tx, actor)
        return result
      })
    })
    active.set(key, { fingerprint, promise })
    try {
      return await promise
    }
    finally { active.delete(key) }
  }
  function closed(input: unknown, keys: string[]) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== keys.sort().join(','))
      return fail('validation-failed', '商务整批恢复只接受完整原身份、原来源和原批次定位')
    return input as Row
  }
  const stable = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][\w-]{2,79}$/i.test(value)
  async function restore(input: unknown, session: Session): Promise<OwnerDocumentMigrationResult> {
    const actor = authorize(session)
    const value = closed(input, ['workspaceId', 'actorId', 'commandId', 'sourceSha256', 'importId'])
    if (!['workspaceId', 'actorId', 'commandId', 'importId'].every(key => stable(value[key])) || value.workspaceId !== actor.workspaceId || value.actorId !== actor.actorId || !/^[a-f0-9]{64}$/.test(text(value.sourceSha256)))
      return fail('validation-failed', '恢复须是同身份、原SQLite摘要、原采用批次和独立原编号')
    const command = value as unknown as OwnerDocumentMigrationResult
    const summary = { ...value, action: 'restore' }
    const fingerprint = digest(summary)
    const key = quantityCanonical(ownerDocumentKey(command))
    const previous = active.get(key)
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        return fail('conflict', '原整批恢复在处理，不能替换目标')
      return previous.promise
    }
    const promise = (async () => {
      await run(session, true, (tx, actor) => fixedIntent(tx, actor, command, 'restore', command.sourceSha256, fingerprint, summary))
      return run(session, true, async (tx, actor) => {
        const receipt = await replay(tx, actor, command.commandId, fingerprint)
        if (receipt)
          return receipt
        const [imported] = await tx.select<{ id: string, evidence_json: string, evidence_sha256: string, source_sha256: string }>('SELECT * FROM owner_document_imports WHERE id=? AND workspace_id=? AND actor_id=?', [command.importId, actor.workspaceId, actor.actorId])
        if (!imported || imported.source_sha256 !== command.sourceSha256 || (await tx.select('SELECT import_id FROM owner_document_import_restores WHERE import_id=?', [command.importId])).length)
          return fail('conflict', '原商务批次不存在、原来源不同或已经整批恢复')
        const evidence = parseOwnerDocumentStoredJson<{ commandId: string, documents: OwnerCommercialDocumentSource[], installed: Record<string, string>, installedFiles: Record<string, string>, installedEvents: Record<string, string>, mappings: Array<{ sourceTable: string, documentId: string }> }>(imported.evidence_json)
        if (digest(evidence) !== imported.evidence_sha256)
          return fail('unavailable', '完整采用证据摘要损坏，不能恢复')
        await readProductionOwnerDocumentState(tx, actor)
        const ids = new Set(evidence.documents.map(document => document.id))
        for (const mapping of evidence.mappings) {
          if (!Object.values(tables).includes(mapping.sourceTable as typeof tables[keyof typeof tables]))
            return fail('unavailable', '原采用映射超出商务owner，不能恢复')
          const [current] = await tx.select<Row>(`SELECT * FROM ${mapping.sourceTable} WHERE id=?`, [mapping.documentId])
          if (!current || digest(current) !== evidence.installed[`${mapping.sourceTable}:${mapping.documentId}`])
            return fail('conflict', '整批危险恢复拒绝：原单据已有后来修改、抵扣或附件动作')
        }
        for (const [fileId, original] of Object.entries(evidence.installedFiles)) {
          const [current] = await tx.select<Row>('SELECT * FROM file_refs WHERE id=?', [fileId])
          if (!current || digest(current) !== original)
            return fail('conflict', '整批危险恢复拒绝：原附件状态已有后来变化')
        }
        const eventIds = new Set(Object.keys(evidence.installedEvents).map(key => key.slice(key.indexOf(':') + 1)))
        for (const [table, parent] of [['penalty_settlement_deductions', 'penalty_id'], ['penalty_rectification_events', 'penalty_id']] as const) {
          for (const event of await tx.select<Row>(`SELECT * FROM ${table}`)) {
            if (!ids.has(text(event[parent])) && !(table === 'penalty_settlement_deductions' && ids.has(text(event.settlement_id))))
              continue
            if (!eventIds.has(text(event.id)) || digest(event) !== evidence.installedEvents[`${table}:${event.id}`])
              return fail('conflict', '整批危险恢复拒绝：双方抵扣或整改有后来事实')
            if (table === 'penalty_settlement_deductions' && !ids.has(text(event.settlement_id)))
              return fail('conflict', '整批危险恢复拒绝：原抵扣仍被本批之外的真实Other结算采用')
          }
        }
        for (const event of await tx.select<Row>('SELECT * FROM owner_document_history')) {
          if (ids.has(text(event.document_id)) && event.command_id !== evidence.commandId)
            return fail('conflict', '整批危险恢复拒绝：原单据已经有后来历史，不能覆盖')
        }
        // Inspect current, archived and fixed-intent consumers alike. Missing JSON is not an empty source.
        const candidates = await tx.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\'')
        for (const { name } of candidates.filter(row => /^(?:owner_|finance_|payment_|receipt_|invoice_|expenditure_|penalty_|payroll_|schedule_|wage_)/.test(row.name))) {
          if (['owner_document_history', 'owner_document_files', 'penalty_settlement_deductions', 'penalty_rectification_events', 'owner_document_import_bindings', 'owner_document_import_restores', 'owner_document_import_commands', 'owner_document_import_resolutions'].includes(name))
            continue
          for (const row of await tx.select<Row>(`SELECT * FROM "${name.replaceAll('"', '""')}"`)) {
            if (Object.values(tables).includes(name as typeof tables[keyof typeof tables]) && ids.has(text(row.id)))
              continue
            if (name === 'owner_document_imports' && row.id === imported.id)
              continue
            if (name === 'owner_document_import_intents' && [evidence.commandId, command.commandId].includes(text(row.command_id)))
              continue
            for (const cell of Object.values(row)) {
              if (references(cell, ids))
                return fail('conflict', '整批危险恢复拒绝：后来的实际收付、商务或冻结来源仍引用原单据')
              if (typeof cell === 'string' && ['{', '['].includes(cell.trimStart()[0] ?? '')) {
                const decoded = parseOwnerDocumentStoredJson<unknown>(cell)
                if (references(decoded, ids))
                  return fail('conflict', '整批危险恢复拒绝：后来的原命令或完整冻结仍消费原单据')
              }
            }
          }
        }
        const now = new Date().toISOString()
        await tx.execute('INSERT INTO owner_document_import_restores VALUES(?,?,?,?)', [imported.id, command.commandId, actor.actorId, now])
        for (const document of evidence.documents) {
          // Original soft deletes remain exactly original; active heads get a new auditable archive version.
          if ((document as OwnerCommercialDocumentSource & { deletedAt?: string }).deletedAt)
            continue
          const after = { ...document, deletedAt: now, version: document.version + 1, updatedAt: now }
          const table = tables[document.kind as keyof typeof tables]
          await tx.execute(`UPDATE ${table} SET deleted_at=?,record_json=?,version=?${table === 'expenditure_settlements' ? ',updated_at=?' : ''} WHERE id=?`, [now, quantityCanonical(after), after.version, ...(table === 'expenditure_settlements' ? [now] : []), document.id])
          await tx.execute('INSERT INTO owner_document_history VALUES(?,?,?,?,?,?,?,?)', [`owner-restore-history-${randomUUID()}`, document.kind, document.id, actor.actorId, command.commandId, quantityCanonical(document), quantityCanonical(after), now])
        }
        const [revision] = await tx.select<{ metadata_json: string }>('SELECT metadata_json FROM owner_document_revision WHERE singleton=1')
        const metadata = parseOwnerDocumentStoredJson<{ migrationKeys: string[], migrationSnapshotFingerprint: string | null }>(revision!.metadata_json)
        metadata.migrationKeys = metadata.migrationKeys.filter(key => !evidence.documents.some(document => key === `${document.kind}\u001F${document.id}`))
        await tx.execute('UPDATE owner_document_revision SET revision=revision+1,metadata_json=? WHERE singleton=1', [quantityCanonical(metadata)])
        const result: OwnerDocumentMigrationResult = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: command.commandId, sourceSha256: imported.source_sha256, importId: imported.id, documentIds: evidence.documents.map(document => document.id), restored: true }
        await tx.execute('INSERT INTO owner_document_import_commands VALUES(?,?,?,?,?,?,?)', [...ownerDocumentKey(command), fingerprint, quantityCanonical(summary), quantityCanonical(result), now])
        await readProductionOwnerDocumentState(tx, actor)
        return result
      })
    })()
    active.set(key, { fingerprint, promise })
    try {
      return await promise
    }
    finally { active.delete(key) }
  }
  async function resolve(input: unknown, session: Session) {
    const actor = authorize(session)
    const descriptor = closed(input, ['workspaceId', 'actorId', 'commandId', 'family', 'action', 'targetId', 'scopeId']) as unknown as CommandRecoveryDescriptor
    if (descriptor.workspaceId !== actor.workspaceId || descriptor.actorId !== actor.actorId || !stable(descriptor.commandId) || descriptor.family !== 'owner-document-import' || !['adopt', 'restore'].includes(descriptor.action) || !/^[a-f0-9]{64}$/.test(text(descriptor.scopeId)) || (descriptor.action === 'adopt' ? descriptor.targetId !== descriptor.scopeId : !stable(descriptor.targetId)))
      return fail('validation-failed', '原商务整批恢复定位与同源身份不完整')
    await active.get(quantityCanonical(ownerDocumentKey(descriptor)))?.promise.catch(() => {})
    return run(session, true, async (tx) => {
      const key = ownerDocumentKey(descriptor)
      const [intent] = await tx.select<{ action: string, scope_id: string, request_json: string, fingerprint: string }>('SELECT * FROM owner_document_import_intents WHERE workspace_id=? AND actor_id=? AND command_id=?', key)
      if (intent) {
        const original = parseOwnerDocumentStoredJson<Row>(intent.request_json)
        if (intent.action !== descriptor.action || intent.scope_id !== descriptor.scopeId || (intent.action === 'restore' && original.importId !== descriptor.targetId) || digest(original) !== intent.fingerprint)
          return fail('conflict', '恢复定位不属于固定原商务整批命令')
      }
      const [receipt] = await tx.select<{ fingerprint: string, result_json: string }>('SELECT * FROM owner_document_import_commands WHERE workspace_id=? AND actor_id=? AND command_id=?', key)
      if (receipt) {
        const result = parseOwnerDocumentStoredJson<OwnerDocumentMigrationResult>(receipt.result_json)
        if (!intent || receipt.fingerprint !== intent.fingerprint || result.sourceSha256 !== descriptor.scopeId || result.commandId !== descriptor.commandId || result.restored !== (descriptor.action === 'restore') || (descriptor.action === 'restore' && result.importId !== descriptor.targetId))
          return fail('unavailable', '原商务整批回执不能与原意图互证')
        return { outcome: 'applied' as const, result }
      }
      if ((await readProductionOwnerDocumentState(tx, actor)).legacyCommandIds.has(descriptor.commandId))
        fail('unavailable', '原Native商务编号仅供来源历史追查，不能封存为当前命令未应用')
      const [sealed] = await tx.select<{ descriptor_json: string }>('SELECT * FROM owner_document_import_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', key)
      if (sealed && sealed.descriptor_json !== quantityCanonical(descriptor))
        return fail('conflict', '原商务整批编号已按其他定位封存')
      if (!sealed)
        await tx.execute('INSERT INTO owner_document_import_resolutions VALUES(?,?,?,?,?)', [...key, quantityCanonical(descriptor), new Date().toISOString()])
      return { outcome: 'not-applied' as const, commandId: descriptor.commandId }
    })
  }
  const state = (session: Session): Promise<OwnerDocumentMigrationState> => run(session, false, async (tx, actor) => {
    await readProductionOwnerDocumentState(tx, actor)
    const rows = await tx.select<{ id: string, source_sha256: string, created_at: string, restored_at: string | null, result_json: string }>(`SELECT i.*,r.restored_at,c.result_json FROM owner_document_imports i LEFT JOIN owner_document_import_restores r ON r.import_id=i.id JOIN owner_document_import_commands c ON c.workspace_id=i.workspace_id AND c.actor_id=i.actor_id AND c.command_id=i.command_id ORDER BY i.created_at,i.id`)
    return { ...actor, capabilities: [...actor.capabilities], sources: rows.map(row => ({ importId: row.id, sourceSha256: row.source_sha256, importedAt: row.created_at, restored: row.restored_at !== null, original: parseOwnerDocumentStoredJson<OwnerDocumentMigrationResult>(row.result_json) })) }
  })
  return { state, preflight, adopt, restore, resolve }
}
