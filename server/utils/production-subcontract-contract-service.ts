import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { SubcontractContractCommandRequestDTO, SubcontractContractCommandResultDTO } from '../../app/lib/subcontract-contract/command-contract'
import type { SubcontractContractFactSources, SubcontractContractFileSource } from '../../app/lib/subcontract-contract/read-contract'
import type { BusinessSession } from './business-session'
import type { ProductionStorage } from './production-storage'
import type { SubcontractContractOwnerSnapshot } from './subcontract-contract-command-test-instance'
import { Buffer } from 'node:buffer'
import { isDeepStrictEqual } from 'node:util'
import { FinanceRepositoryProblem } from '../../app/lib/finance/central-contract'
import { OurSignatoryRepositoryProblem } from '../../app/lib/our-signatory/contract'
import { recordContractNumber } from '../../app/lib/our-signatory/number-registry'
import { readOurSignatories, resolveContractSignatory } from '../../app/lib/our-signatory/storage'
import { buildSubcontractContractDetail, buildSubcontractContractListPage, parseSubcontractContractDetailQuery, parseSubcontractContractListQuery, SubcontractContractRepositoryProblem } from '../../app/lib/subcontract-contract/repository'
import { commandFingerprint } from './command-journal'
import { contractOriginalBytes } from './contract-original'
import { assertProductionConstructionScope, constructionScopeDigest, constructionScopeLinkId, persistProductionConstructionScopeCommand, readProductionConstructionScopeMainFact as readProductionConstructionMainFact, readProductionConstructionMainOptions, readProductionConstructionScopeLink, readProductionConstructionScopeSourceFact, validateProductionConstructionScopeState } from './production-construction-scope-record'
import { readProductionOwnerDocumentFacts } from './production-owner-document-service'
import { subcontractFailure as fail, productionSubcontractLegacyCommandExists, subcontractCanonicalRecord, validateProductionSubcontractState } from './production-subcontract-contract-record'
import { productionSubcontractContractConsumed } from './production-subcontract-contract-reference-guard'
import { loadProductionSuppliers } from './production-supplier-record'
import { createReadMeta, withOriginReadMeta, withReadMeta } from './read-meta'
import { parseSubcontractContractCommandRequest } from './subcontract-contract-command-request'
import { createSubcontractContractCommandTestInstance } from './subcontract-contract-command-test-instance'

type Session = () => BusinessSession
type Row = Record<string, unknown>
/** SQLite datetime text is UTC in the established source adapter; this projection never rewrites original snapshots. */
function readFileTime(value: string | null): string | null {
  return value !== null && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?$/.test(value) ? `${value.replace(' ', 'T')}Z` : value
}
async function actualDocuments(tx: TransactionDb, actor: BusinessSession, scope: { projectId?: string, contractId?: string }) {
  const empty = { changes: [], settlements: [], penalties: [], paymentApplications: [], paymentRecords: [] } satisfies Partial<SubcontractContractFactSources>
  if (!actor.capabilities.includes('subcontract-document:read'))
    return { state: 'forbidden' as const, sourceVersion: null, facts: empty, sources: [] }
  try {
    const actual = await readProductionOwnerDocumentFacts(tx, actor, scope)
    const factsFor = (kind: typeof actual.documents[number]['kind']) => actual.documents.filter(row => row.kind === kind).map(row => ({ dataOrigin: row.dataOrigin, id: row.id, contractId: row.contractId, no: row.no, name: row.name, amount: row.amount, date: row.approvalDate ?? row.applicationDate, status: row.status, ...(kind === 'sub_settlement' ? { settlementKind: row.documentType === '完工结算' ? 'completion' as const : 'progress' as const } : {}) }))
    const settlements = actual.documents.filter(row => row.kind === 'sub_settlement')
    const applications = [...new Map(settlements.flatMap(settlement => [...(settlement.subcontractSettlementEvidence?.applications ?? []), ...(settlement.subcontractSettlementEvidence?.cashApplications ?? [])].map(row => [row.id, { dataOrigin: settlement.dataOrigin, id: row.id, contractId: row.contractId, no: row.no ?? '', name: row.name ?? '', amount: row.applyAmount ?? null, date: row.date ?? null, status: row.status }] as const))).values()]
    const payments = [...new Map(settlements.flatMap(settlement => (settlement.subcontractSettlementEvidence?.cashApplications ?? []).flatMap(application => (application.payments ?? []).map(payment => [payment.id, { dataOrigin: settlement.dataOrigin, id: payment.id, contractId: settlement.contractId, no: payment.no ?? '', name: payment.name ?? '', amount: payment.totalAmount ?? payment.amount, date: payment.date ?? null, status: payment.confirmed ? 'confirmed' : 'draft' }] as const)))).values()]
    return { state: 'readable' as const, sourceVersion: actual.sourceVersion, sources: actual.sourceEvidence, facts: { changes: factsFor('sub_change'), settlements: factsFor('sub_settlement'), penalties: factsFor('project_penalty'), paymentApplications: applications, paymentRecords: payments } }
  }
  catch { return { state: 'unavailable' as const, sourceVersion: null, facts: empty, sources: [] } }
}
async function domain(tx: TransactionDb, actor: BusinessSession, state: SubcontractContractOwnerSnapshot) {
  const projects = await tx.select<{ id: string, name: string, deleted_at: string | null }>('SELECT id,name,deleted_at FROM projects ORDER BY id')
  const suppliers = [...(await loadProductionSuppliers(tx, actor)).suppliers.values()].map(row => ({ id: row.id, name: row.draft.name ?? '', contact: row.draft.contact ?? '', contactPhone: row.draft.contactPhone ?? '' }))
  const owner = createSubcontractContractCommandTestInstance({ projects, suppliers, resolveSignatory: async (draft, existing, required) => {
    try {
      return await resolveContractSignatory(tx, { id: draft.ourSignatoryId, version: draft.ourSignatoryVersion, prior: existing?.draft.ourSignatorySnapshot, required })
    }
    catch (cause) {
      if (cause instanceof OurSignatoryRepositoryProblem)
        throw new SubcontractContractRepositoryProblem(cause.problem)
      throw cause
    }
  } })
  owner.importState({ ...state, supplements: state.supplements.filter(row => !('deletedAt' in row) || row.deletedAt === null) })
  return { owner, projects, suppliers }
}
async function persist(tx: TransactionDb, before: SubcontractContractOwnerSnapshot, after: SubcontractContractOwnerSnapshot, actor: BusinessSession, command: SubcontractContractCommandRequestDTO) {
  for (const record of after.contracts) {
    const id = record.draft.id
    const previous = before.contracts.find(row => row.draft.id === id)
    if (previous && isDeepStrictEqual(subcontractCanonicalRecord(previous), subcontractCanonicalRecord(record)))
      continue
    if (record.version !== (previous?.version ?? 0) + 1)
      fail('unavailable', '分包版本不连续，停止保存')
    const body = JSON.stringify(subcontractCanonicalRecord(record))
    await tx.execute('INSERT INTO subcontract_contract_records(id,project_id,supplier_id,deleted_at,record_json) VALUES(?,?,?,NULL,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,supplier_id=excluded.supplier_id,record_json=excluded.record_json', [id, record.draft.projectId ?? null, record.draft.supplierId ?? null, body])
    try {
      await recordContractNumber(tx, { owner: 'subcontract-contracts', id, number: record.draft.no ?? '', version: String(record.version), occurredAt: record.updatedAt, formal: !['draft', '草稿'].includes(record.draft.status ?? '') }, { enforce: command.action === 'submit', historyId: `subcontract-${id}-v${record.version}` })
    }
    catch (cause) {
      if (cause instanceof OurSignatoryRepositoryProblem)
        throw new SubcontractContractRepositoryProblem(cause.problem)
      throw cause
    }
    for (const file of record.attachments) {
      const prior = previous?.attachments.find(row => row.id === file.id)
      if (prior) {
        if (prior.deletedAt !== file.deletedAt)
          await tx.execute('UPDATE file_refs SET deleted_at=? WHERE id=?', [file.deletedAt, file.id])
        continue
      }
      const original = record.originals.get(file.id)
      if (!original)
        fail('unavailable', '分包签约原件缺真实字节，不能存目录冒正文')
      const metadata = { id: file.id, owner_type: 'contract', owner_id: id, file_name: file.fileName, file_path: '', file_size: file.fileSize, mime_type: file.mimeType, category: file.category, uploader: actor.actorId, uploaded_at: file.uploadedAt, deleted_at: file.deletedAt }
      await tx.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,uploaded_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', Object.values(metadata))
      await tx.execute('INSERT INTO file_payloads VALUES(?,?,?)', [file.id, original.bytes, original.sha256])
      await tx.execute('INSERT INTO subcontract_contract_files VALUES(?,?,\'head\',NULL,?,\'embedded\',?)', [file.id, id, JSON.stringify(metadata), original.sha256])
    }
    await tx.execute('INSERT INTO subcontract_contract_versions VALUES(?,?,?,?,?,?)', [id, record.version, actor.actorId, command.commandId, body, record.updatedAt])
  }
  await tx.execute('UPDATE subcontract_contract_revision SET revision=? WHERE singleton=1', [after.sourceVersion])
}
export function createProductionSubcontractContractService(storage: ProductionStorage) {
  function authorize(actor: BusinessSession, write = false) {
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !actor.capabilities.includes('subcontract-contract:read') || (write && !actor.capabilities.includes('subcontract-contract:write')))
      fail('forbidden', '当前可信身份不能维护该正式分包合同')
  }
  async function run<T>(session: Session, write: boolean, work: (tx: TransactionDb, actor: BusinessSession, state: SubcontractContractOwnerSnapshot) => Promise<T>) {
    const queued = structuredClone(session())
    authorize(queued, write)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      const actor = structuredClone(session())
      authorize(actor, write)
      if (!isDeepStrictEqual(queued, actor))
        fail('forbidden', '排队期间分包权限或来源已变化')
      const validated = await validateProductionSubcontractState(tx, actor)
      const result = await work(tx, actor, validated.state)
      if (!isDeepStrictEqual(actor, session()))
        fail('forbidden', '分包操作期间身份或权限变化，保留原编号')
      return result
    }).catch((cause) => {
      if (cause instanceof FinanceRepositoryProblem)
        throw new SubcontractContractRepositoryProblem(cause.problem)
      throw cause
    })
  }
  async function meta(tx: TransactionDb, actor: BusinessSession, state: SubcontractContractOwnerSnapshot, operation: string, scope: unknown, commercial: Awaited<ReturnType<typeof actualDocuments>>) {
    const asOf = new Date().toISOString()
    const scopeSource = actor.capabilities.includes('construction-scope:read')
      ? (await validateProductionConstructionScopeState(tx), { key: 'construction-scope', state: 'readable' as const, sourceVersion: commandFingerprint(await tx.select('SELECT * FROM construction_scope_links ORDER BY id')), asOf })
      : { key: 'construction-scope', state: 'forbidden' as const, sourceVersion: null, asOf: null }
    return createReadMeta({ session: actor, schemaVersion: 'subcontract-contract-read-v2', operation, dataOrigin: 'real', asOf, coverage: 'complete', scope, sources: [{ key: 'subcontract-contracts', state: 'readable', sourceVersion: `subcontract-${state.sourceVersion}`, asOf }, { key: 'subcontract-documents', state: commercial.state, sourceVersion: commercial.sourceVersion, asOf: commercial.state === 'readable' ? asOf : null }, { key: 'contract-finance', state: 'unavailable', sourceVersion: null, asOf: null }, ...commercial.sources.filter(source => source.key !== 'owner-documents').map(source => ({ ...source, key: `business-${source.key}` })), scopeSource] })
  }
  async function visible(tx: TransactionDb, actor: BusinessSession, state: SubcontractContractOwnerSnapshot) {
    const { owner } = await domain(tx, actor, state)
    const hidden = new Set((await tx.select<{ id: string }>('SELECT c.id FROM subcontract_contract_records c LEFT JOIN projects p ON p.id=c.project_id WHERE c.deleted_at IS NOT NULL OR p.deleted_at IS NOT NULL')).map(row => row.id))
    return { owner, rows: owner.rows().filter(row => !hidden.has(row.id)).map(row => ({ ...row, projectPermission: actor.capabilities.includes('project:list:read') ? 'allowed' as const : 'forbidden' as const, supplierPermission: actor.capabilities.includes('supplier:list:read') ? 'allowed' as const : 'forbidden' as const })) }
  }
  async function facts(tx: TransactionDb, owner: ReturnType<typeof createSubcontractContractCommandTestInstance>) {
    const facts = owner.facts()
    const files = await tx.select<SubcontractContractFileSource>(`SELECT 'real' AS dataOrigin,b.file_ref_id AS id,b.contract_id AS contractId,
      f.file_name AS fileName,f.file_size AS fileSize,f.mime_type AS mimeType,f.category,
      CASE WHEN json_type(b.original_metadata_json,'$.uploaded_at')='null' THEN NULL ELSE f.uploaded_at END AS uploadedAt
      FROM subcontract_contract_files b LEFT JOIN subcontract_contract_supplements s ON s.id=b.supplement_id
      JOIN file_refs f ON f.id=b.file_ref_id
      WHERE f.deleted_at IS NULL AND (b.owner_kind='head' OR json_extract(s.record_json,'$.deletedAt') IS NULL) ORDER BY b.file_ref_id`)
    facts.files = files.map(file => ({ ...file, uploadedAt: readFileTime(file.uploadedAt) }))
    return facts
  }
  return {
    context(session: Session) {
      return run(session, false, async (tx, actor, state) => {
        if (!actor.capabilities.includes('subcontract-contract:write'))
          fail('forbidden', '当前分包表单只读')
        const { projects, suppliers } = await domain(tx, actor, state)
        return { ...actor, projects: actor.capabilities.includes('project:list:read') ? projects.filter(row => row.deleted_at === null).map(row => ({ id: row.id, label: row.name })) : [], suppliers: actor.capabilities.includes('supplier:list:read') ? suppliers.map(row => ({ id: row.id, label: row.name, contactName: row.contact, contactPhone: row.contactPhone })) : [], ourSignatories: actor.capabilities.includes('our-signatory:read') ? (await readOurSignatories(tx)).records : [], constructionMains: await readProductionConstructionMainOptions(tx, actor) }
      })
    },
    form(id: string, session: Session) {
      return run(session, false, async (tx, actor, state) => {
        if (!(await tx.select('SELECT c.id FROM subcontract_contract_records c LEFT JOIN projects p ON p.id=c.project_id WHERE c.id=? AND c.deleted_at IS NULL AND p.deleted_at IS NULL', [id]))[0])
          fail('not-found', '原分包合同不存在或已归档')
        const form = (await domain(tx, actor, state)).owner.form(id, actor)
        const metadata = await tx.select<{ file_ref_id: string, original_metadata_json: string }>('SELECT file_ref_id,original_metadata_json FROM subcontract_contract_files WHERE contract_id=? AND owner_kind=\'head\'', [id])
        const attachments = form.attachments.map(file => ({ ...file, uploadedAt: JSON.parse(metadata.find(row => row.file_ref_id === file.id)!.original_metadata_json).uploaded_at === null ? null : readFileTime(file.uploadedAt), deletedAt: readFileTime(file.deletedAt) }))
        const relation = await readProductionConstructionScopeLink(tx, { domain: 'subcontract-contract', id })
        const selected = relation?.mainId ? await readProductionConstructionMainFact(tx, actor, relation.mainId) : null
        return { ...form, attachments, constructionMain: selected && selected.projectId ? { id: selected.id, projectId: selected.projectId, basis: selected.basis } : null }
      })
    },
    list(input: Row, session: Session) {
      return run(session, false, async (tx, actor, state) => {
        const query = parseSubcontractContractListQuery(input)
        if (query.origin === 'demo' || query.includeDemo)
          fail('forbidden', '正式分包仅使用真实来源')
        const read = await visible(tx, actor, state)
        const commercial = await actualDocuments(tx, actor, { projectId: query.projectId ?? undefined })
        const proof = await meta(tx, actor, state, 'subcontract-contract:list', query, commercial)
        const page = buildSubcontractContractListPage({ contracts: read.rows, facts: { ...await facts(tx, read.owner), ...commercial.facts }, query, asOf: proof.asOf, sourceVersion: proof.sourceVersion, capabilities: [...actor.capabilities] })
        for (const row of page.items) {
          row.amounts.invoiced = null
          row.amounts.paid = null
          if (commercial.state !== 'readable')
            row.amounts.settled = null
          row.amounts.bySettlementPayable = null
          row.amounts.byInvoicePayable = null
          if (commercial.state !== 'readable')
            row.amounts.completionSettlement = null
        }
        Object.assign(page.summary.origins.real, { ...(commercial.state !== 'readable' ? { settledAmount: null } : {}), paidAmount: null })
        const demo = createReadMeta({ session: actor, schemaVersion: 'subcontract-contract-read-v2', operation: 'subcontract-contract:list', dataOrigin: 'demo', asOf: proof.asOf, coverage: 'complete', scope: query, sources: [] })
        return withOriginReadMeta(page, { real: proof, demo })
      })
    },
    detail(id: string, input: Row, session: Session) {
      return run(session, false, async (tx, actor, state) => {
        const query = parseSubcontractContractDetailQuery(id, input)
        if (query.origin !== 'real' || query.includeDemo)
          fail('forbidden', '正式分包不读演示源')
        const read = await visible(tx, actor, state)
        const commercial = await actualDocuments(tx, actor, { contractId: id })
        const proof = await meta(tx, actor, state, 'subcontract-contract:detail', query, commercial)
        const dto = buildSubcontractContractDetail({ contracts: read.rows, facts: { ...await facts(tx, read.owner), ...commercial.facts }, query, asOf: proof.asOf, sourceVersion: proof.sourceVersion, capabilities: [...actor.capabilities] })
        Object.assign(dto.contract.amounts, { invoiced: null, paid: null, ...(commercial.state !== 'readable' ? { settled: null, completionSettlement: null } : {}), bySettlementPayable: null, byInvoicePayable: null })
        return withReadMeta(dto, proof)
      })
    },
    async execute(input: unknown, session: Session, id?: string): Promise<SubcontractContractCommandResultDTO> {
      const command = parseSubcontractContractCommandRequest(input, id ? { kind: 'update', routeId: id } : { kind: 'create' })
      if (!/^[a-z0-9][\w-]{2,79}$/i.test(command.commandId))
        fail('validation-failed', '分包原编号无效')
      for (const file of command.attachments.add ?? [])
        contractOriginalBytes(file, { required: true, fail: message => fail('validation-failed', message) })
      const fingerprint = commandFingerprint(command)
      await run(session, true, async (tx, actor) => {
        if (command.workspaceId !== actor.workspaceId || command.actorId !== actor.actorId)
          fail('forbidden', '分包原意图身份与可信来源不同')
        const old = (await tx.select<Row>('SELECT * FROM subcontract_contract_intents WHERE command_id=?', [command.commandId]))[0]
        if (old && old.fingerprint !== fingerprint)
          fail('conflict', '分包原编号不能改变目标、工程选择或正文')
        if (!old && await productionSubcontractLegacyCommandExists(tx, command.commandId))
          fail('unavailable', '原库保有旧分包同编号依据，不能用新意图覆盖未知历史')
        if (!old)
          await tx.execute('INSERT INTO subcontract_contract_intents VALUES(?,?,?,?,?,?,?)', [command.commandId, actor.workspaceId, actor.actorId, command.id ?? null, fingerprint, JSON.stringify(command), new Date().toISOString()])
      })
      let absent = false
      try {
        return await run(session, true, async (tx, actor, before) => {
          const receipt = (await tx.select<Row>('SELECT * FROM subcontract_contract_receipts WHERE command_id=?', [command.commandId]))[0]
          if (receipt) {
            if (receipt.fingerprint !== fingerprint)
              fail('conflict', '分包回执对应另一份原正文')
            return JSON.parse(String(receipt.result_json))
          }
          absent = true
          if ((await tx.select('SELECT command_id FROM subcontract_contract_resolutions WHERE command_id=?', [command.commandId]))[0])
            fail('conflict', '分包原号已封存，不能迟到写入')
          const selected = command.constructionMain
          if (!command.id && !selected)
            fail('validation-failed', '新建工程名称必须明确选择真实施工主合同，不默认第一份或草稿后再绑')
          if (selected) {
            const main = await readProductionConstructionMainFact(tx, actor, selected.id)
            if (!main.eligible || main.basis !== selected.basis || main.projectId !== selected.projectId || command.draft.projectId !== selected.projectId)
              fail('conflict', '所选工程/主合同真实资格或采用依据已经变化')
          }
          const { owner, projects, suppliers } = await domain(tx, actor, before)
          if (command.draft.projectId && (!actor.capabilities.includes('project:list:read') || !projects.some(row => row.id === command.draft.projectId && row.deleted_at === null)))
            fail('validation-failed', '工程项目已失效、删除或无权读取')
          if (command.draft.supplierId && (!actor.capabilities.includes('supplier:list:read') || !suppliers.some(row => row.id === command.draft.supplierId)))
            fail('validation-failed', '真实分供方身份不存在或无读取权限')
          if (command.id && !(await tx.select('SELECT id FROM subcontract_contract_records WHERE id=? AND deleted_at IS NULL', [command.id]))[0])
            fail('not-found', '原分包合同不存在或已经归档')
          const prior = command.id ? before.contracts.find(row => row.draft.id === command.id) : null
          if (prior && prior.draft.projectId !== command.draft.projectId && await productionSubcontractContractConsumed(tx, command.id!))
            fail('relationship-mismatch', '分包已被真实工程关联、费用或原历史消费，不能只改项目破坏原归属')
          const saved = await owner.execute(command, actor)
          await persist(tx, before, owner.exportState(), actor, command)
          if (selected) {
            await assertProductionConstructionScope(tx, actor)
            if (!actor.capabilities.includes('construction-scope:write'))
              fail('forbidden', '新建工程关联需要原子保存施工归属的权限')
            const source = { domain: 'subcontract-contract' as const, id: saved.id }
            const existing = await readProductionConstructionScopeLink(tx, source)
            const fact = await readProductionConstructionScopeSourceFact(tx, actor, source, true)
            if (!fact.basis || fact.projectId !== selected.projectId)
              fail('unavailable', '新保存分包与所选工程真实来源不一致，整个事务拒绝')
            const scopeCommand = { workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'construction-scope:write' as const, commandId: `construction-scope-${commandFingerprint([actor.workspaceId, actor.actorId, command.commandId, saved.id]).slice(0, 32)}`, source, projectId: selected.projectId, action: 'bind' as const, mainId: selected.id, baseVersion: existing?.version ?? null, sourceBasis: fact.basis, mainBasis: selected.basis, originalSourceCommand: { family: 'subcontract-contract' as const, commandId: command.commandId } }
            await tx.execute('INSERT INTO construction_scope_intents VALUES(?,?,?,?,?,?,?,?)', [scopeCommand.commandId, actor.workspaceId, actor.actorId, constructionScopeLinkId(source), 'bind', constructionScopeDigest(scopeCommand), JSON.stringify(scopeCommand), new Date().toISOString()])
            await persistProductionConstructionScopeCommand(tx, actor, scopeCommand, true)
          }
          await tx.execute('INSERT INTO subcontract_contract_receipts VALUES(?,?,?,?,?,?,?)', [command.commandId, actor.workspaceId, actor.actorId, saved.id, fingerprint, JSON.stringify(saved), saved.updatedAt])
          return saved
        })
      }
      catch (cause) {
        if (absent && cause instanceof SubcontractContractRepositoryProblem && ['validation-failed', 'conflict', 'not-found', 'relationship-mismatch'].includes(cause.problem.code)) {
          await run(session, true, (tx, actor) => tx.execute('INSERT OR IGNORE INTO subcontract_contract_resolutions VALUES(?,?,?,?)', [command.commandId, actor.workspaceId, actor.actorId, new Date().toISOString()]))
          Object.assign(cause.problem, { commandId: command.commandId, commandOutcome: 'not-applied' })
        }
        throw cause
      }
    },
    resolve(commandId: string, session: Session) {
      if (!/^[a-z0-9][\w-]{2,79}$/i.test(commandId))
        fail('validation-failed', '分包原编号无效')
      return run(session, true, async (tx, actor) => {
        const receipt = (await tx.select<Row>('SELECT * FROM subcontract_contract_receipts WHERE command_id=?', [commandId]))[0]
        if (receipt)
          return { outcome: 'applied' as const, result: JSON.parse(String(receipt.result_json)) as SubcontractContractCommandResultDTO }
        if (await productionSubcontractLegacyCommandExists(tx, commandId))
          fail('unavailable', '原分包旧编号历史结果仍未知，不能认定未应用或重发')
        await tx.execute('INSERT OR IGNORE INTO subcontract_contract_resolutions VALUES(?,?,?,?)', [commandId, actor.workspaceId, actor.actorId, new Date().toISOString()])
        return { outcome: 'not-applied' as const, commandId }
      })
    },
    file(id: string, fileId: string, origin: string, session: Session) {
      return run(session, false, async (tx, _actor, state) => {
        if (origin !== 'real' || !(await tx.select('SELECT c.id FROM subcontract_contract_records c LEFT JOIN projects p ON p.id=c.project_id WHERE c.id=? AND c.deleted_at IS NULL AND p.deleted_at IS NULL', [id]))[0])
          fail('not-found', '原分包所属归档身份不可日常下载，保历史原件')
        const owner = state.contracts.find(row => row.draft.id === id)
        const file = owner?.attachments.find(row => row.id === fileId && row.deletedAt === null)
        if (file) {
          const original = owner!.originals.get(fileId)
          if (!original)
            fail('unavailable', '旧分包原件缺正文，保留缺件证据')
          return { bytes: Buffer.from(original.bytes), sha256: original.sha256, fileName: file.fileName, mimeType: file.mimeType }
        }
        const supplement = (await tx.select<Row>('SELECT b.*,f.file_name,f.mime_type,f.deleted_at,p.content FROM subcontract_contract_files b JOIN file_refs f ON f.id=b.file_ref_id LEFT JOIN file_payloads p ON p.file_ref_id=b.file_ref_id WHERE b.file_ref_id=? AND b.contract_id=? AND b.owner_kind=\'supplement\'', [fileId, id]))[0]
        if (!supplement || supplement.deleted_at !== null)
          fail('not-found', '分包或协议原件不属于当前稳定归属')
        if (!(supplement.content instanceof Uint8Array))
          fail('unavailable', '历史协议原件缺完整正文')
        return { bytes: Buffer.from(supplement.content), sha256: String(supplement.sha256), fileName: String(supplement.file_name), mimeType: String(supplement.mime_type) }
      })
    },
  }
}
