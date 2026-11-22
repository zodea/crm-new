import type { ConstructionContractCommandResultDTO } from '../../app/lib/construction-contract/command-contract'
import type { ConstructionContractFactSources, ConstructionContractFileSource } from '../../app/lib/construction-contract/read-contract'
import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BusinessSession } from './business-session'
import type { ConstructionContractOwnerSnapshot } from './construction-contract-command-test-instance'
import type { ProductionStorage } from './production-storage'
import { Buffer } from 'node:buffer'
import { isDeepStrictEqual } from 'node:util'
import { buildConstructionContractDetail, buildConstructionContractListPage, ConstructionContractRepositoryProblem, parseConstructionContractDetailQuery, parseConstructionContractListQuery } from '../../app/lib/construction-contract/repository'
import { OurSignatoryRepositoryProblem } from '../../app/lib/our-signatory/contract'
import { recordContractNumber } from '../../app/lib/our-signatory/number-registry'
import { readOurSignatories, resolveContractSignatory } from '../../app/lib/our-signatory/storage'
import { commandFingerprint } from './command-journal'
import { parseConstructionContractCommandRequest } from './construction-contract-command-request'
import { createConstructionContractCommandTestInstance } from './construction-contract-command-test-instance'
import { contractOriginalBytes } from './contract-original'
import { constructionCanonicalRecord, constructionFailure as fail, productionConstructionLegacyCommandExists, readProductionConstructionState, validateProductionConstructionState } from './production-construction-contract-record'
import { productionConstructionContractConsumed } from './production-construction-contract-reference-guard'
import { readProductionOwnerDocumentFacts } from './production-owner-document-service'
import { createReadMeta, withOriginReadMeta, withReadMeta } from './read-meta'

type Session = () => BusinessSession
type Row = Record<string, unknown>
/** Public UTC/unknown timestamp projection; canonical snapshots and original source metadata stay unchanged. */
function readFileTime(value: string | null): string | null {
  return value !== null && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?$/.test(value) ? `${value.replace(' ', 'T')}Z` : value
}
async function originalFiles(tx: TransactionDb): Promise<ConstructionContractFileSource[]> {
  const files = await tx.select<ConstructionContractFileSource>(`SELECT 'real' AS dataOrigin,b.file_ref_id AS id,b.contract_id AS contractId,
    f.file_name AS fileName,f.file_size AS fileSize,f.mime_type AS mimeType,f.category,
    CASE WHEN json_type(b.original_metadata_json,'$.uploaded_at')='null' THEN NULL ELSE f.uploaded_at END AS uploadedAt
    FROM construction_contract_files b LEFT JOIN construction_contract_supplements s ON s.id=b.supplement_id JOIN file_refs f ON f.id=b.file_ref_id
    WHERE f.deleted_at IS NULL AND (b.owner_kind='head' OR json_extract(s.record_json,'$.deletedAt') IS NULL) ORDER BY b.file_ref_id`)
  return files.map(file => ({ ...file, uploadedAt: readFileTime(file.uploadedAt) }))
}
async function actualDocuments(tx: TransactionDb, actor: BusinessSession, scope: { projectId?: string, contractId?: string }) {
  const empty = { changes: [], monthlyStatements: [], finalSettlements: [], penalties: [], acceptances: [], warranties: [] } satisfies Partial<ConstructionContractFactSources>
  if (!actor.capabilities.includes('owner-document:read'))
    return { state: 'forbidden' as const, sourceVersion: null, facts: empty, sources: [] }
  try {
    const actual = await readProductionOwnerDocumentFacts(tx, actor, scope)
    const factsFor = (kind: typeof actual.documents[number]['kind']) => actual.documents.filter(row => row.kind === kind).map(row => ({ dataOrigin: row.dataOrigin, id: row.id, ownerDocumentId: row.id, sourceId: row.sourceId, contractId: row.contractId, no: row.no, name: row.name, amount: row.amount, date: row.approvalDate ?? row.applicationDate, status: row.status }))
    const acceptances = factsFor('acceptance')
    return { state: 'readable' as const, sourceVersion: actual.sourceVersion, sources: actual.sourceEvidence, facts: { changes: factsFor('owner_change'), monthlyStatements: factsFor('owner_report'), finalSettlements: factsFor('final_settlement'), penalties: factsFor('owner_penalty'), acceptances, warranties: acceptances.filter(row => ['warranty', 'expired'].includes(row.status)) } }
  }
  catch { return { state: 'unavailable' as const, sourceVersion: null, facts: empty, sources: [] } }
}
async function domain(tx: TransactionDb, actor: BusinessSession, state: ConstructionContractOwnerSnapshot) {
  const projects = await tx.select<{ id: string, name: string, customer_id: string | null, deleted_at: string | null }>('SELECT id,name,customer_id,deleted_at FROM projects ORDER BY id')
  const customers = (await tx.select<{ id: string, name: string, deleted_at: string | null }>('SELECT id,name,deleted_at FROM customers ORDER BY id')).map(row => ({ id: row.id, name: row.name, deletedAt: row.deleted_at }))
  const service = createConstructionContractCommandTestInstance({ projects: projects.map(row => ({ id: row.id, name: row.name, customerId: row.customer_id })), customers, resolveSignatory: async (draft, existing, required) => {
    try {
      return await resolveContractSignatory(tx, { id: draft.ourSignatoryId, version: draft.ourSignatoryVersion, prior: existing?.draft.ourSignatorySnapshot, required })
    }
    catch (cause) {
      if (cause instanceof OurSignatoryRepositoryProblem)
        throw new ConstructionContractRepositoryProblem(cause.problem)
      throw cause
    }
  } })
  service.importState({ ...state, supplements: state.supplements.filter(row => !('deletedAt' in row) || row.deletedAt === null) })
  return { service, projects, customers }
}
async function save(tx: TransactionDb, before: ConstructionContractOwnerSnapshot, after: ConstructionContractOwnerSnapshot, actor: BusinessSession, commandId: string, enforceNumber: boolean) {
  for (const record of after.contracts) {
    const previous = before.contracts.find(row => row.id === record.id)
    if (previous && isDeepStrictEqual(constructionCanonicalRecord(previous), constructionCanonicalRecord(record)))
      continue
    if (record.version !== (previous?.version ?? 0) + 1)
      fail('unavailable', '施工合同版本跳跃，停止保存')
    const body = JSON.stringify(constructionCanonicalRecord(record))
    await tx.execute('INSERT INTO construction_contract_records(id,project_id,customer_id,deleted_at,record_json) VALUES (?,?,?,NULL,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,customer_id=excluded.customer_id,record_json=excluded.record_json', [record.id, record.draft.projectId ?? null, record.draft.customerId ?? null, body])
    try {
      await recordContractNumber(tx, { owner: 'construction-contracts', id: record.id, number: record.draft.no ?? '', version: String(record.version), occurredAt: record.updatedAt, formal: !['draft', '草稿'].includes(record.draft.status ?? '') }, { enforce: enforceNumber, historyId: `construction-${record.id}-v${record.version}` })
    }
    catch (cause) {
      if (cause instanceof OurSignatoryRepositoryProblem)
        throw new ConstructionContractRepositoryProblem(cause.problem)
      throw cause
    }
    for (const file of record.attachments) {
      const old = previous?.attachments.find(row => row.id === file.id)
      if (old) {
        if (old.deletedAt !== file.deletedAt)
          await tx.execute('UPDATE file_refs SET deleted_at=? WHERE id=?', [file.deletedAt, file.id])
        continue
      }
      const original = record.originals.get(file.id)
      if (!original)
        fail('unavailable', '新施工原件缺完整字节，不能保存元数据代替')
      const metadata = { id: file.id, owner_type: 'contract', owner_id: record.id, file_name: file.fileName, file_path: '', file_size: file.fileSize, mime_type: file.mimeType, category: file.category, uploader: actor.actorId, uploaded_at: file.uploadedAt, deleted_at: file.deletedAt }
      await tx.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,uploaded_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', Object.values(metadata))
      await tx.execute('INSERT INTO file_payloads VALUES (?,?,?)', [file.id, original.bytes, original.sha256])
      await tx.execute('INSERT INTO construction_contract_files VALUES (?, ?,\'head\',NULL,?,\'embedded\',?)', [file.id, record.id, JSON.stringify(metadata), original.sha256])
    }
    await tx.execute('INSERT INTO construction_contract_versions VALUES (?,?,?,?,?,?)', [record.id, record.version, actor.actorId, commandId, body, record.updatedAt])
  }
  await tx.execute('UPDATE construction_contract_revision SET revision=? WHERE singleton=1', [after.sourceVersion])
}
export function createProductionConstructionContractService(storage: ProductionStorage) {
  function authorize(actor: BusinessSession, write = false) {
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !actor.capabilities.includes('construction-contract:read') || (write && !actor.capabilities.includes('construction-contract:write')))
      fail('forbidden', '当前可信身份不能读取或维护这份正式施工主合同')
  }
  async function run<T>(session: Session, write: boolean, work: (tx: TransactionDb, actor: BusinessSession, state: ConstructionContractOwnerSnapshot) => Promise<T>) {
    const queued = structuredClone(session())
    authorize(queued, write)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      const actor = structuredClone(session())
      authorize(actor, write)
      if (!isDeepStrictEqual(actor, queued))
        fail('forbidden', '排队期间施工合同会话或权限已变化')
      await validateProductionConstructionState(tx, actor)
      const state = await readProductionConstructionState(tx, actor)
      const result = await work(tx, actor, state)
      const latest = session()
      authorize(latest, write)
      if (!isDeepStrictEqual(actor, latest))
        fail('forbidden', '施工合同操作期间身份或权限变化，请保留原编号')
      return result
    })
  }
  async function meta(tx: TransactionDb, actor: BusinessSession, state: ConstructionContractOwnerSnapshot, operation: string, scope: unknown, commercial: Awaited<ReturnType<typeof actualDocuments>>) {
    const asOf = new Date().toISOString()
    return createReadMeta({ session: actor, schemaVersion: 'construction-contract-read-v2', operation, dataOrigin: 'real', asOf, coverage: 'complete', scope, sources: [
      { key: 'construction-contracts', state: 'readable', sourceVersion: `construction-${state.sourceVersion}`, asOf },
      { key: 'projects', state: actor.capabilities.includes('project:list:read') ? 'readable' : 'forbidden', sourceVersion: actor.capabilities.includes('project:list:read') ? `project-${(await tx.select<{ revision: number }>('SELECT revision FROM project_revision WHERE singleton=1'))[0]!.revision}` : null, asOf: actor.capabilities.includes('project:list:read') ? asOf : null },
      { key: 'customers', state: actor.capabilities.includes('customer:list:read') ? 'readable' : 'forbidden', sourceVersion: actor.capabilities.includes('customer:list:read') ? `customer-${(await tx.select<{ revision: number }>('SELECT revision FROM customer_revision WHERE singleton=1'))[0]!.revision}` : null, asOf: actor.capabilities.includes('customer:list:read') ? asOf : null },
      { key: 'owner-documents', state: commercial.state, sourceVersion: commercial.sourceVersion, asOf: commercial.state === 'readable' ? asOf : null },
      { key: 'construction-finance', state: 'unavailable', sourceVersion: null, asOf: null },
      ...commercial.sources.filter(source => source.key !== 'owner-documents').map(source => ({ ...source, key: `business-${source.key}` })),
    ] })
  }
  async function readableRows(tx: TransactionDb, actor: BusinessSession, state: ConstructionContractOwnerSnapshot) {
    const { service } = await domain(tx, actor, state)
    const hidden = new Set((await tx.select<{ id: string }>('SELECT id FROM construction_contract_records WHERE deleted_at IS NOT NULL UNION SELECT c.id FROM construction_contract_records c JOIN projects p ON p.id=c.project_id WHERE p.deleted_at IS NOT NULL UNION SELECT c.id FROM construction_contract_records c JOIN customers u ON u.id=c.customer_id WHERE u.deleted_at IS NOT NULL')).map(row => row.id))
    return { service, rows: service.rows().filter(row => !hidden.has(row.id)).map(row => ({ ...row, settledAmount: null, invoicedAmount: null, receivedAmount: null, projectPermission: actor.capabilities.includes('project:list:read') ? 'allowed' as const : 'forbidden' as const, customerPermission: actor.capabilities.includes('customer:list:read') ? 'allowed' as const : 'forbidden' as const })) }
  }
  return {
    context(session: Session) {
      return run(session, false, async (tx, actor, state) => {
        if (!actor.capabilities.includes('construction-contract:write'))
          fail('forbidden', '当前施工主合同表单只读')
        const { projects, customers } = await domain(tx, actor, state)
        return { workspaceId: actor.workspaceId, actorId: actor.actorId, capabilities: [...actor.capabilities], projects: actor.capabilities.includes('project:list:read') ? projects.filter(row => row.deleted_at === null).map(row => ({ id: row.id, label: row.name, customerId: row.customer_id })) : [], customers: actor.capabilities.includes('customer:list:read') ? customers.filter(row => row.deletedAt === null).map(row => ({ id: row.id, label: row.name })) : [], ourSignatories: actor.capabilities.includes('our-signatory:read') ? (await readOurSignatories(tx)).records : [] }
      })
    },
    form(id: string, session: Session) {
      return run(session, false, async (tx, actor, state) => {
        const { service } = await domain(tx, actor, state)
        if (!(await tx.select('SELECT c.id FROM construction_contract_records c LEFT JOIN projects p ON p.id=c.project_id LEFT JOIN customers u ON u.id=c.customer_id WHERE c.id=? AND c.deleted_at IS NULL AND p.deleted_at IS NULL AND u.deleted_at IS NULL', [id]))[0])
          fail('not-found', '施工合同不存在或已归档')
        const form = service.form(id, actor)
        const metadata = await tx.select<{ file_ref_id: string, original_metadata_json: string }>('SELECT file_ref_id,original_metadata_json FROM construction_contract_files WHERE contract_id=? AND owner_kind=\'head\'', [id])
        const attachments = form.attachments.map(file => ({ ...file, uploadedAt: JSON.parse(metadata.find(row => row.file_ref_id === file.id)!.original_metadata_json).uploaded_at === null ? null : readFileTime(file.uploadedAt), deletedAt: readFileTime(file.deletedAt) }))
        return { ...form, attachments }
      })
    },
    list(input: Row, session: Session) {
      return run(session, false, async (tx, actor, state) => {
        const query = parseConstructionContractListQuery(input)
        if (query.includeDemo || query.origin === 'demo')
          fail('forbidden', '正式施工合同只读取真实来源')
        const read = await readableRows(tx, actor, state)
        const commercial = await actualDocuments(tx, actor, { projectId: query.projectId ?? undefined })
        const proof = await meta(tx, actor, state, 'construction-contract:list', query, commercial)
        const facts: ConstructionContractFactSources = { ...read.service.facts(), files: await originalFiles(tx), ...commercial.facts }
        const page = buildConstructionContractListPage({ contracts: read.rows, facts, query, asOf: proof.asOf, sourceVersion: proof.sourceVersion, capabilities: [...actor.capabilities] })
        if (commercial.state !== 'readable' || !actor.capabilities.includes('boq:read')) {
          for (const row of page.items)
            row.amounts.changed = null
          page.summary.origins.real.changedAmount = null
        }
        const demo = createReadMeta({ session: actor, schemaVersion: 'construction-contract-read-v2', operation: 'construction-contract:list', dataOrigin: 'demo', asOf: proof.asOf, coverage: 'complete', scope: query, sources: [] })
        return withOriginReadMeta(page, { real: proof, demo })
      })
    },
    detail(id: string, input: Row, session: Session) {
      return run(session, false, async (tx, actor, state) => {
        const query = parseConstructionContractDetailQuery(id, input)
        if (query.origin !== 'real' || query.includeDemo)
          fail('forbidden', '正式施工合同不读取演示来源')
        const read = await readableRows(tx, actor, state)
        const commercial = await actualDocuments(tx, actor, { contractId: id })
        const proof = await meta(tx, actor, state, 'construction-contract:detail', query, commercial)
        const facts: ConstructionContractFactSources = { ...read.service.facts(), files: await originalFiles(tx), ...commercial.facts }
        const dto = buildConstructionContractDetail({ contracts: read.rows, facts, query, asOf: proof.asOf, sourceVersion: proof.sourceVersion, capabilities: [...actor.capabilities] })
        if (commercial.state !== 'readable' || !actor.capabilities.includes('boq:read'))
          dto.contract.amounts.changed = null
        return withReadMeta(dto, proof)
      })
    },
    async execute(body: unknown, session: Session, id?: string): Promise<ConstructionContractCommandResultDTO> {
      const command = parseConstructionContractCommandRequest(body, id ? { kind: 'update', routeId: id } : { kind: 'create' })
      if (!/^[A-Z0-9][\w-]{2,79}$/i.test(command.commandId))
        fail('validation-failed', '施工主合同原编号无效')
      for (const file of command.attachments.add ?? [])
        contractOriginalBytes(file, { required: true, fail: message => fail('validation-failed', message) })
      const fingerprint = commandFingerprint(command)
      await run(session, true, async (tx, actor) => {
        if (command.workspaceId !== actor.workspaceId || command.actorId !== actor.actorId)
          fail('forbidden', '施工命令身份与可信会话不一致')
        const original = (await tx.select<Row>('SELECT * FROM construction_contract_intents WHERE command_id=?', [command.commandId]))[0]
        if (original && original.fingerprint !== fingerprint)
          fail('conflict', '同一原编号不能改用其他动作、目标或正文')
        if (!original && await productionConstructionLegacyCommandExists(tx, command.commandId))
          fail('unavailable', '原施工图保有同编号历史依据，但可信原意图和操作者映射未确认；保留原编号，不能改写或重发')
        if (!original)
          await tx.execute('INSERT INTO construction_contract_intents VALUES (?,?,?,?,?,?,?)', [command.commandId, actor.workspaceId, actor.actorId, command.id ?? null, fingerprint, JSON.stringify(command), new Date().toISOString()])
      })
      let absent = false
      try {
        return await run(session, true, async (tx, actor, before) => {
          const receipt = (await tx.select<{ fingerprint: string, result_json: string }>('SELECT * FROM construction_contract_receipts WHERE command_id=?', [command.commandId]))[0]
          if (receipt) {
            if (receipt.fingerprint !== fingerprint)
              fail('conflict', '原编号已用于另一份施工合同正文')
            return JSON.parse(receipt.result_json)
          }
          absent = true
          if ((await tx.select('SELECT command_id FROM construction_contract_resolutions WHERE command_id=?', [command.commandId]))[0])
            fail('conflict', '原编号已确认未应用，迟到请求不能再写入')
          const { service, projects, customers } = await domain(tx, actor, before)
          if (command.draft.projectId && (!actor.capabilities.includes('project:list:read') || !projects.some(row => row.id === command.draft.projectId && row.deleted_at === null)))
            fail('validation-failed', '实际项目已删除、无权限或不属于可信正式来源')
          if (command.draft.customerId && (!actor.capabilities.includes('customer:list:read') || !customers.some(row => row.id === command.draft.customerId && row.deletedAt === null)))
            fail('validation-failed', '实际客户已删除或不在当前可信来源')
          if (command.id && !(await tx.select('SELECT id FROM construction_contract_records WHERE id=? AND deleted_at IS NULL', [command.id]))[0])
            fail('not-found', '施工合同已经归档，不能覆盖原历史')
          const previous = command.id && before.contracts.find(row => row.id === command.id)
          if (previous && (previous.draft.projectId ?? null) !== (command.draft.projectId ?? null) && await productionConstructionContractConsumed(tx, previous.id))
            fail('relationship-mismatch', '这份施工主合同已有真实业务、原意图或历史引用，不能改写为另一项目；原归属与历史继续保留')
          const result = await service.execute(command, actor)
          await save(tx, before, service.exportState(), actor, command.commandId, command.action === 'submit')
          await tx.execute('INSERT INTO construction_contract_receipts VALUES (?,?,?,?,?,?,?)', [command.commandId, actor.workspaceId, actor.actorId, result.id, fingerprint, JSON.stringify(result), result.updatedAt])
          return result
        })
      }
      catch (cause) {
        if (absent && cause instanceof ConstructionContractRepositoryProblem && ['validation-failed', 'conflict', 'not-found', 'relationship-mismatch'].includes(cause.problem.code)) {
          await run(session, true, async (tx, actor) => {
            await tx.execute('INSERT OR IGNORE INTO construction_contract_resolutions VALUES (?,?,?,?)', [command.commandId, actor.workspaceId, actor.actorId, new Date().toISOString()])
          })
          Object.assign(cause.problem, { commandId: command.commandId, commandOutcome: 'not-applied' })
        }
        throw cause
      }
    },
    resolve(commandId: string, session: Session) {
      if (!/^[A-Z0-9][\w-]{2,79}$/i.test(commandId))
        fail('validation-failed', '原施工合同编号无效')
      return run(session, true, async (tx, actor) => {
        const row = (await tx.select<Row>('SELECT * FROM construction_contract_receipts WHERE command_id=?', [commandId]))[0]
        if (row)
          return { outcome: 'applied' as const, result: JSON.parse(String(row.result_json)) as ConstructionContractCommandResultDTO }
        if (await productionConstructionLegacyCommandExists(tx, commandId))
          fail('unavailable', '原施工图保有同编号历史依据，不能将未知旧结果封存为未应用；请保留原编号核对')
        await tx.execute('INSERT OR IGNORE INTO construction_contract_resolutions VALUES (?,?,?,?)', [commandId, actor.workspaceId, actor.actorId, new Date().toISOString()])
        return { outcome: 'not-applied' as const, commandId }
      })
    },
    file(id: string, fileId: string, origin: string, session: Session) {
      return run(session, false, async (tx, _actor, state) => {
        if (origin !== 'real')
          fail('forbidden', '正式施工原件不接受其他来源')
        if (!(await tx.select('SELECT c.id FROM construction_contract_records c LEFT JOIN projects p ON p.id=c.project_id LEFT JOIN customers u ON u.id=c.customer_id WHERE c.id=? AND c.deleted_at IS NULL AND p.deleted_at IS NULL AND u.deleted_at IS NULL', [id]))[0])
          fail('not-found', '施工原件所属主合同或祖先已归档，历史原件保留')
        const owner = state.contracts.find(row => row.id === id)
        const metadata = owner?.attachments.find(row => row.id === fileId && row.deletedAt === null)
        if (!metadata) {
          const supplement = (await tx.select<Row>('SELECT b.*,f.file_name,f.mime_type,f.file_size,f.deleted_at,p.content,p.sha256 AS payload_sha256 FROM construction_contract_files b JOIN file_refs f ON f.id=b.file_ref_id LEFT JOIN file_payloads p ON p.file_ref_id=b.file_ref_id WHERE b.file_ref_id=? AND b.contract_id=? AND b.owner_kind=\'supplement\'', [fileId, id]))[0]
          if (!supplement || supplement.deleted_at !== null)
            fail('not-found', '施工或协议原件不存在、已删除或不属于原主合同')
          if (!(supplement.content instanceof Uint8Array))
            fail('unavailable', '历史协议原件缺正文，缺件证据保留')
          return { bytes: Buffer.from(supplement.content), sha256: String(supplement.sha256), fileName: String(supplement.file_name), mimeType: String(supplement.mime_type) }
        }
        const original = owner!.originals.get(fileId)
        if (!original)
          fail('unavailable', '历史施工原件缺正文，保留缺件证据')
        return { bytes: Buffer.from(original.bytes), sha256: original.sha256, fileName: metadata.fileName, mimeType: metadata.mimeType }
      })
    },
  }
}
