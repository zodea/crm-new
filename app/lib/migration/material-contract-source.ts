import type { CoreMigrationSourceEntityDTO } from './core-contract'

export interface MaterialContractSourceGraph {
  schemaVersion: 1
  head: Record<string, unknown>
  lines: Record<string, unknown>[]
  deductions: Record<string, unknown>[]
  attachments: Record<string, unknown>[]
  audit: Record<string, unknown>[]
  ourSignatoryEvidence?: { record: Record<string, unknown>, history: Record<string, unknown>[] }
}
type Select = <T extends Record<string, unknown>>(sql: string) => Promise<T[]>
const mainSql = 'SELECT * FROM contracts WHERE kind = \'材采\' ORDER BY id'
const protocolSql = 'SELECT * FROM contract_supplements ORDER BY id'
const lineSql = 'SELECT * FROM contract_line_items ORDER BY id'
const protocolLineSql = 'SELECT * FROM contract_supplement_line_items ORDER BY id'
const deductionSql = 'SELECT * FROM contract_deductions ORDER BY id'
const fileSql = `SELECT f.id,f.owner_type AS ownerType,f.owner_id AS ownerId,f.file_name AS fileName,
  f.file_path AS filePath,f.file_size AS fileSize,f.mime_type AS mimeType,f.category,f.uploader,
  f.uploaded_at AS uploadedAt,f.deleted_at AS deletedAt,p.encoding AS payloadEncoding,p.content AS payloadBase64
  FROM file_refs f LEFT JOIN file_payloads p ON p.file_ref_id=f.id
  WHERE f.owner_type IN ('contract','contract_supplement') ORDER BY f.id`
const auditSql = 'SELECT * FROM operation_logs WHERE table_name IN (\'contracts\',\'contract_supplements\',\'contract_line_items\',\'contract_supplement_line_items\',\'contract_deductions\',\'file_refs\') ORDER BY id'

/** 原始所有权图和软删事实一并携带；不升级备份，不拿当前价格补旧协议证据。 */
export async function readMaterialContractGraphs(select: Select, sourceVersion: number) {
  if (![47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60].includes(sourceVersion))
    throw new Error('材采来源版本未经真实结构核验')
  const [heads, protocols, lines, protocolLines, deductions, attachments, audit, contracts] = await Promise.all([
    select(mainSql),
    select(protocolSql),
    select(lineSql),
    sourceVersion >= 50 ? select(protocolLineSql) : Promise.resolve([]),
    sourceVersion >= 50 ? select(deductionSql) : Promise.resolve([]),
    select(fileSql),
    select(auditSql),
    select('SELECT id,kind FROM contracts ORDER BY id'),
  ])
  const mainIds = new Set(heads.map(row => String(row.id)))
  const signatories = sourceVersion >= 53 ? await select('SELECT * FROM our_signatories ORDER BY id') : []
  const signatoryHistory = sourceVersion >= 53 ? await select('SELECT * FROM our_signatory_history ORDER BY signatory_id,version') : []
  const allContractIds = new Set(contracts.map(row => String(row.id)))
  const allProtocolIds = new Set(protocols.map(row => String(row.id)))
  const materialProtocols = protocols.filter(row => mainIds.has(String(row.contract_id)))
  const protocolIds = new Set(materialProtocols.map(row => String(row.id)))
  if (lines.some(row => !allContractIds.has(String(row.contract_id)))
    || protocolLines.some(row => !allProtocolIds.has(String(row.supplement_id)))
    || deductions.some(row => (row.contract_id == null) === (row.supplement_id == null)
      || (row.contract_id != null && !allContractIds.has(String(row.contract_id)))
      || (row.supplement_id != null && !allProtocolIds.has(String(row.supplement_id))))) {
    throw new Error('材采明细或减项存在孤儿或不明确父键，停止接管并保留旧库原证据')
  }
  if (protocolLines.some(row => !protocolIds.has(String(row.supplement_id)))
    || deductions.some(row => row.contract_id != null ? !mainIds.has(String(row.contract_id)) : !protocolIds.has(String(row.supplement_id)))) {
    throw new Error('材采自有协议明细或减项的父合同种类无法核实，停止接管')
  }
  const graphs = new Map<string, MaterialContractSourceGraph>()
  for (const head of [...heads, ...materialProtocols]) {
    const supplement = protocolIds.has(String(head.id))
    const id = String(head.id)
    const ownedLines = (supplement ? protocolLines : lines).filter(row => row[supplement ? 'supplement_id' : 'contract_id'] === id)
    const ownedDeductions = deductions.filter(row => row[supplement ? 'supplement_id' : 'contract_id'] === id)
    const files = attachments.filter(row => row.ownerId === id && row.ownerType === (supplement ? 'contract_supplement' : 'contract'))
    const identities = new Set([id, ...ownedLines.map(row => String(row.id)), ...ownedDeductions.map(row => String(row.id)), ...files.map(row => String(row.id))])
    const selected = head.our_signatory_id != null ? signatories.find(row => row.id === head.our_signatory_id) : null
    if (head.our_signatory_id != null && !selected)
      throw new Error('旧合同主体关系缺少同图真实目录，停止接管')
    graphs.set(id, { schemaVersion: 1, head, lines: ownedLines, deductions: ownedDeductions, attachments: files, audit: audit.filter(row => identities.has(String(row.record_id))), ...(selected ? { ourSignatoryEvidence: { record: selected, history: signatoryHistory.filter(row => row.signatory_id === selected.id) } } : {}) })
  }
  const entities: CoreMigrationSourceEntityDTO[] = heads.map((head) => {
    const amount = head.amount == null ? null : Number(head.amount)
    if (amount !== null && (!Number.isFinite(amount) || Math.abs(amount) > Number.MAX_SAFE_INTEGER / 100))
      throw new Error('旧材采金额无法安全核验')
    return { legacyId: String(head.id), name: typeof head.name === 'string' ? head.name : '', references: { projectId: head.project_id as string | null, supplierId: head.supplier_id as string | null }, amount: amount === null ? null : amount.toFixed(2), deletedAt: head.deleted_at as string | null, attributes: { materialGraphJson: JSON.stringify(graphs.get(String(head.id))) } }
  })
  return { entities, graphs }
}
