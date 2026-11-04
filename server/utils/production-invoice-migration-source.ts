import type { TransactionDb } from '../../app/lib/db/coordinator'
import { Buffer } from 'node:buffer'
import { CentralInvoiceProblem } from '../../app/lib/invoice/central-contract'
import { withVerifiedMigrationSnapshot } from './migration-snapshot'

type Row = Record<string, unknown>
function fail(message: string): never {
  throw new CentralInvoiceProblem('validation-failed', `旧发票迁入：${message}；请保留完整原库。`)
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Z0-9][\w-]{2,79}$/i.test(value)

/** SQLite 扩展字段可能是 BLOB 或超出 JS 安全范围的整数，不能经 number 转换后伪装为原值。 */
async function sourceRows(tx: TransactionDb, table: string, where = ''): Promise<Row[]> {
  const columns = await tx.select<{ name: string }>(`PRAGMA table_info("${table}")`)
  if (!columns.length)
    return fail('原始表不存在')
  const names = new Set(columns.map(column => column.name))
  let prefix = '__invoice_exact_'
  while (columns.some((_, index) => names.has(`${prefix}type_${index}`) || names.has(`${prefix}value_${index}`))) prefix += '_'
  const quoted = (name: string) => `"${name.replace(/"/g, '""')}"`
  const expressions = columns.flatMap((column, index) => {
    const name = quoted(column.name)
    const unusual = `typeof(${name})='blob' OR (typeof(${name})='integer' AND (${name}>9007199254740991 OR ${name}<-9007199254740991))`
    return [
      `CASE WHEN ${unusual} THEN NULL ELSE ${name} END AS ${name}`,
      `CASE WHEN ${unusual} THEN typeof(${name}) END AS ${quoted(`${prefix}type_${index}`)}`,
      `CASE WHEN typeof(${name})='blob' THEN hex(${name}) WHEN ${unusual} THEN CAST(${name} AS TEXT) END AS ${quoted(`${prefix}value_${index}`)}`,
    ]
  })
  const rows = await tx.select<Row>(`SELECT ${expressions.join(',')} FROM "${table}" ${where}`)
  return rows.map((row) => {
    for (const [index, column] of columns.entries()) {
      const typeKey = `${prefix}type_${index}`
      const valueKey = `${prefix}value_${index}`
      const type = row[typeKey]
      const value = row[valueKey]
      delete row[typeKey]
      delete row[valueKey]
      if (type !== null) {
        if ((type !== 'blob' && type !== 'integer') || typeof value !== 'string')
          return fail('无法完整保留原始扩展字段')
        row[column.name] = { sqliteType: type, exactValue: value }
      }
    }
    return row
  })
}

/** 仅检查经过摘要、完整性和只读核验的完整来源；不升级、不写入原库。 */
export async function readLegacyInvoiceSource(tx: TransactionDb, evidence: { sha256: string, schemaVersion: number }, options: { inspectCompany?: boolean } = {}) {
  if (!/^[a-f0-9]{64}$/.test(evidence.sha256) || ![59, 60].includes(evidence.schemaVersion))
    return fail('来源版本或摘要尚未核验')
  const columns = new Set((await tx.select<{ name: string }>('PRAGMA table_info(invoices)')).map(column => column.name))
  const required = ['id', 'file_name', 'file_path', 'file_size', 'page_count', 'invoice_type', 'invoice_number', 'invoice_date', 'buyer', 'buyer_tax_no', 'seller', 'seller_tax_no', 'amount', 'tax_amount', 'total_amount', 'tax_rate', 'remark', 'project_id', 'project_name', 'supplier_id', 'contract_id', 'ocr_status', 'review_status', 'account_status', 'dup_status', 'source', 'owner_kind', 'print_rotation', 'print_count', 'ocr_confidence', 'confirmed_at', 'archived_at', 'items', 'field_confidence', 'created_at', 'updated_at', 'deleted_at']
  if (required.some(column => !columns.has(column)))
    return fail('旧发票表缺少已核实的身份、金额、状态或历史字段')
  const companySchema = options.inspectCompany ? ',\'company_expense_contracts\'' : ''
  const schema = await tx.select<Row>(`SELECT type,name,tbl_name,sql FROM sqlite_master
    WHERE tbl_name IN ('invoices','file_refs','file_payloads','payment_application_invoice_allocations','payment_applications','operation_logs'${companySchema})
    AND sql IS NOT NULL ORDER BY tbl_name,type,name`)
  const heads = await sourceRows(tx, 'invoices', 'ORDER BY id')
  // 公司合同旧键当前没有中央映射路径；只保留原始行会让正式关系静默丢失。
  const companyIds = [...new Set(heads.map(row => row.company_expense_contract_id).filter(value => value !== undefined && value !== null && value !== ''))]
  if (companyIds.length && !options.inspectCompany)
    return fail('公司支出合同关联尚未接通，暂不能迁入，避免丢失原合同关系')
  const allocations = await sourceRows(tx, 'payment_application_invoice_allocations', 'ORDER BY id')
  const files = await sourceRows(tx, 'file_refs', `WHERE owner_type='invoice' ORDER BY id`)
  const payloads = await sourceRows(tx, 'file_payloads', `WHERE file_ref_id IN (SELECT id FROM file_refs WHERE owner_type='invoice') ORDER BY file_ref_id`)
  const logs = await sourceRows(tx, 'operation_logs', `WHERE table_name IN ('invoices','invoice_archive_provenance') ORDER BY id`)
  const scalar = (value: unknown) => value === null || typeof value === 'string'
    || (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)))
  const invalidRows = (rows: Row[], known: string[]) => rows.some(row => Object.entries(row).some(([key, value]) => !scalar(value) && (known.includes(key) || !value || typeof value !== 'object' || Array.isArray(value)
    || !['blob', 'integer'].includes(String((value as Row).sqliteType)) || typeof (value as Row).exactValue !== 'string')))
  if (invalidRows(heads, required)
    || invalidRows(allocations, ['id', 'invoice_id', 'payment_application_id', 'allocated_amount', 'note', 'created_at', 'updated_at', 'deleted_at'])
    || invalidRows(files, ['id', 'owner_type', 'owner_id', 'file_name', 'file_path', 'file_size', 'mime_type', 'category', 'uploader', 'uploaded_at', 'deleted_at'])
    || invalidRows(payloads, ['file_ref_id', 'encoding', 'content'])
    || invalidRows(logs, ['id', 'table_name', 'record_id', 'action', 'before_data', 'after_data', 'operator', 'created_at'])) {
    return fail('原始记录含无法完整表达的字段类型或数值')
  }
  const invoiceIds = new Set(heads.map(row => row.id))
  if (heads.some(row => !id(row.id)) || invoiceIds.size !== heads.length
    || allocations.some(row => !id(row.id) || !id(row.invoice_id) || !invoiceIds.has(row.invoice_id) || typeof row.allocated_amount !== 'number' || !Number.isFinite(row.allocated_amount) || row.allocated_amount <= 0)
    || files.some(row => !id(row.id) || !id(row.owner_id) || !invoiceIds.has(row.owner_id))
    || payloads.some(row => !files.some(file => file.id === row.file_ref_id))) {
    return fail('发票、原件或历史分摊缺少稳定身份或真实归属')
  }
  const applications = await tx.select<Row>('SELECT id,project_id,supplier_id,deleted_at FROM payment_applications ORDER BY id')
  if (allocations.some(row => !applications.some(application => application.id === row.payment_application_id)))
    return fail('历史付款分摊缺少原申请')
  const identityTables = [
    { field: 'project_id', table: 'projects' },
    { field: 'supplier_id', table: 'suppliers' },
    { field: 'contract_id', table: 'contracts' },
  ] as const
  const references: Array<{ table: string, id: string, row: Row }> = []
  for (const { field, table } of identityTables) {
    for (const reference of new Set(heads.map(row => row[field]).filter(value => value !== null && value !== undefined && value !== ''))) {
      if (!id(reference))
        return fail('发票关系身份无效')
      const columns = table === 'contracts' ? 'id,name,kind,project_id,supplier_id,deleted_at' : 'id,name,deleted_at'
      const row = (await tx.select<Row>(`SELECT ${columns} FROM ${table} WHERE id=?`, [reference]))[0]
      if (!row)
        return fail('发票引用的原始项目、分供方或合同不存在')
      references.push({ table, id: reference, row })
    }
  }
  if (companyIds.length) {
    if (heads.some(row => row.company_expense_contract_id && (row.project_id || row.contract_id)))
      return fail('公司支出合同与旧项目或普通合同关系冲突')
    const companyColumns = new Set((await tx.select<{ name: string }>('PRAGMA table_info(company_expense_contracts)')).map(column => column.name))
    if (['id', 'name', 'deleted_at'].some(column => !companyColumns.has(column)))
      return fail('原公司支出合同表或身份依据缺失')
    for (const reference of companyIds) {
      if (!id(reference))
        return fail('原公司支出合同身份无效')
      const [row] = await tx.select<Row>('SELECT id,name,deleted_at FROM company_expense_contracts WHERE id=?', [reference])
      if (!row)
        return fail('发票引用的原公司支出合同不存在')
      references.push({ table: 'company_expense_contracts', id: reference, row })
    }
  }
  for (const head of heads) {
    const contract = references.find(reference => reference.table === 'contracts' && reference.id === head.contract_id)?.row
    if (contract && ['project_id', 'supplier_id'].some(field => head[field] != null && contract[field] != null && head[field] !== contract[field]))
      return fail('发票与原合同的已知项目或分供方关系冲突')
  }
  const filesByInvoice = new Map<string, Array<{ row: Row, payload: Row | null, bodyState: 'embedded' | 'metadata-only' | 'external-required' }>>()
  for (const row of files) {
    const payload = payloads.find(candidate => candidate.file_ref_id === row.id) ?? null
    if (payload && (payload.encoding !== 'base64' || typeof payload.content !== 'string'))
      return fail('原件正文编码无法核验')
    if (payload) {
      const bytes = Buffer.from(String(payload.content), 'base64')
      if (bytes.toString('base64') !== payload.content || !(row.file_size === null || row.file_size === undefined || (typeof row.file_size === 'number' && Number.isSafeInteger(row.file_size) && row.file_size === bytes.length)))
        return fail('原件正文和真实长度不一致')
    }
    const group = filesByInvoice.get(String(row.owner_id)) ?? []
    group.push({ row, payload, bodyState: payload ? 'embedded' : row.file_path ? 'external-required' : 'metadata-only' })
    filesByInvoice.set(String(row.owner_id), group)
  }
  const graph = heads.map((head) => {
    const existingFiles = filesByInvoice.get(String(head.id)) ?? []
    // 旧 store 曾在缺失识别金额时写入 0，单靠旧数值不能证明它是真实零。
    const ambiguousZeroFields = ['amount', 'tax_amount', 'total_amount'].filter(field => head[field] === 0)
    return {
      head,
      files: existingFiles,
      originalState: existingFiles.length ? 'recorded' as const : head.file_path ? 'legacy-path-unverified' as const : head.source === 'scan' ? 'session-original-unavailable' as const : 'no-original-recorded' as const,
      ambiguousZeroFields,
      allocations: allocations.filter(row => row.invoice_id === head.id),
      logs: logs.filter(row => row.record_id === head.id),
    }
  })
  return { ...evidence, schema, graph, references, applications, orphanLogs: logs.filter(row => !invoiceIds.has(row.record_id)) }
}

/** 预览只开放来源摘要与身份，不向客户端回传路径、原始票面或历史日志正文。 */
export async function previewProtectedLegacyInvoices(
  source: { sha256: string, payloadBase64: string },
  identity: { workspaceId: string, actorId: string },
  session: () => { workspaceId: string, actorId: string, capabilities: readonly string[] },
) {
  const authorize = () => {
    const actor = session()
    if (actor.workspaceId !== identity.workspaceId || actor.actorId !== identity.actorId
      || !actor.capabilities.includes('finance-invoice:read') || !actor.capabilities.includes('finance-invoice:import')) {
      throw new CentralInvoiceProblem('forbidden', '当前身份无发票旧库预检权限。')
    }
    return JSON.stringify({ workspaceId: actor.workspaceId, actorId: actor.actorId, capabilities: [...actor.capabilities].sort() })
  }
  const originalActor = authorize()
  const result = await withVerifiedMigrationSnapshot(source, async (tx, evidence) => {
    const graph = await readLegacyInvoiceSource(tx, evidence, { inspectCompany: true })
    return {
      sourceSha256: graph.sha256,
      schemaVersion: graph.schemaVersion,
      invoices: graph.graph.map(invoice => ({
        legacyId: String(invoice.head.id),
        invoiceNumber: typeof invoice.head.invoice_number === 'string' ? invoice.head.invoice_number : '',
        deleted: invoice.head.deleted_at !== null,
        sourceState: invoice.originalState,
        ambiguousZeroFields: invoice.ambiguousZeroFields,
        historicalAllocationCount: invoice.allocations.length,
        originalCount: invoice.files.length,
        originalBodyStates: invoice.files.map(file => file.bodyState),
        ...(typeof invoice.head.company_expense_contract_id === 'string' && invoice.head.company_expense_contract_id ? { companyContractId: invoice.head.company_expense_contract_id } : {}),
      })),
      references: graph.references.map(reference => ({
        table: reference.table,
        legacyId: reference.id,
        label: typeof reference.row.name === 'string' ? reference.row.name : '',
        deleted: reference.row.deleted_at !== null,
        ...(reference.table === 'contracts' ? { kind: typeof reference.row.kind === 'string' ? reference.row.kind : null, projectId: typeof reference.row.project_id === 'string' ? reference.row.project_id : null, supplierId: typeof reference.row.supplier_id === 'string' ? reference.row.supplier_id : null } : {}),
      })),
      orphanLogCount: graph.orphanLogs.length,
    }
  })
  if (originalActor !== authorize())
    throw new CentralInvoiceProblem('forbidden', '预检期间身份或权限已变化。')
  return result
}
