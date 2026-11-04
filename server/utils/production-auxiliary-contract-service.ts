import type { AuxiliaryContractDetail, AuxiliaryContractFact, AuxiliaryImportCommand, AuxiliaryImportPreview, AuxiliaryImportResult } from '../../app/lib/auxiliary-contract/contract'
import type { ContractFormAttachment } from '../../app/lib/contract/forms'
import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { AuxiliaryStoredContract } from './auxiliary-contract-test-instance'
import type { BusinessSession } from './business-session'
import type { ProductionStorage } from './production-storage'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { auxiliaryProblem } from '../../app/lib/auxiliary-contract/contract'
import { sumAuxiliaryMoney } from '../../app/lib/auxiliary-contract/facts'
import { isEffectiveExpenditureContract } from '../../app/lib/contract/effective-status'
import { auxiliaryContractSourceEntity } from '../../app/lib/migration/auxiliary-contract-source'
import { validateOtherSettlementJournal } from '../../app/lib/other-settlement/storage'
import { decodeOurSignatorySnapshot, OurSignatoryRepositoryProblem } from '../../app/lib/our-signatory/contract'
import { recordContractNumber } from '../../app/lib/our-signatory/number-registry'
import { readOurSignatories, resolveContractSignatory } from '../../app/lib/our-signatory/storage'
import { migratedAuxiliaryContract } from './auxiliary-contract-migration'
import { createAuxiliaryContractTestInstance } from './auxiliary-contract-test-instance'
import { commandFingerprint } from './command-journal'
import { contractOriginalBytes, contractOriginalDigest } from './contract-original'
import { captureMigrationDomainRows } from './migration-domain-evidence'
import { withVerifiedMigrationSnapshot } from './migration-snapshot'
import { auxiliaryFailure as fail, auxiliaryHash as hash, auxiliaryIdentity as identity, productionAuxiliaryLegacyCommandExists as legacyCommandExists, parseProductionAuxiliaryCommand as parseCommand, auxiliaryJson as parseJson, parseProductionAuxiliaryEnvelope, auxiliaryTime as time, validateProductionAuxiliaryState } from './production-auxiliary-contract-record'
import { appendProductionConstructionScopeBinding } from './production-construction-scope-command'
import { readProductionConstructionMainOptions, readProductionConstructionScopeLink, readProductionConstructionScopeMainFact } from './production-construction-scope-record'
import { productionRuntime } from './production-runtime'
import { loadProductionSuppliers } from './production-supplier-record'

import { createReadMeta, withOriginReadMeta, withReadMeta } from './read-meta'

type Row = Record<string, unknown>
type ReadTx = Pick<TransactionDb, 'select'>
type Session = () => BusinessSession
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)

const productionServices = new WeakMap<object, ReturnType<typeof createProductionAuxiliaryContractService>>()
export function productionAuxiliaryContractRuntime() {
  const runtime = productionRuntime()
  if (!runtime)
    return null
  let contracts = productionServices.get(runtime.storage)
  if (!contracts) {
    contracts = createProductionAuxiliaryContractService(runtime.storage)
    productionServices.set(runtime.storage, contracts)
  }
  return { ...runtime, contracts }
}

export function createProductionAuxiliaryContractService(storage: ProductionStorage) {
  const authorize = (actor: BusinessSession, write: boolean, importing = false) => {
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !actor.capabilities.includes('auxiliary-contract:read') || (write && !actor.capabilities.includes('auxiliary-contract:write')) || (importing && !actor.capabilities.includes('auxiliary-contract:import')))
      return fail('forbidden', '辅助合同可信身份或独立权限不同')
  }
  async function run<T>(session: Session, write: boolean, work: (tx: TransactionDb, actor: BusinessSession, data: Awaited<ReturnType<typeof validateProductionAuxiliaryState>>) => Promise<T>, importing = false) {
    const queued = structuredClone(session())
    authorize(queued, write, importing)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      const actor = structuredClone(session())
      authorize(actor, write, importing)
      if (!isDeepStrictEqual(actor, queued))
        return fail('forbidden', '辅助合同排队期间身份或权限变化')
      const data = await validateProductionAuxiliaryState(tx, actor)
      const result = await work(tx, actor, data)
      if (write)
        await validateProductionAuxiliaryState(tx, actor)
      const latest = structuredClone(session())
      authorize(latest, write, importing)
      if (!isDeepStrictEqual(actor, latest))
        return fail('forbidden', '辅助合同操作期间身份或权限变化，事务撤回并保留原编号')
      return result
    })
  }
  async function owner(tx: TransactionDb, actor: BusinessSession, data: Awaited<ReturnType<typeof validateProductionAuxiliaryState>>) {
    const projects = actor.capabilities.includes('project:list:read') ? await tx.select<{ id: string, name: string }>('SELECT id,name FROM projects WHERE deleted_at IS NULL ORDER BY name,id') : []
    const suppliers = actor.capabilities.includes('supplier:list:read') ? [...(await loadProductionSuppliers(tx, actor)).suppliers.values()].map(row => ({ id: row.id, name: row.draft.name ?? '', version: String(row.version) })) : []
    const instance = createAuxiliaryContractTestInstance({ projects, suppliers })
    const hidden = new Set((await tx.select<Row>('SELECT c.id FROM auxiliary_contract_records c LEFT JOIN projects p ON p.id=c.project_id WHERE c.deleted_at IS NOT NULL OR p.deleted_at IS NOT NULL')).map(row => row.id))
    instance.importState({ ...data.state, contracts: data.state.contracts.filter(row => !hidden.has(row.draft.id)).map(row => ({ ...row, facts: data.supplements.filter(fact => fact.contractId === row.draft.id && fact.deletedAt === null) })) })
    return { instance, projects, suppliers }
  }
  async function meta(tx: TransactionDb, actor: BusinessSession, operation: string, scope: Row, revision: number) {
    const asOf = new Date().toISOString()
    return createReadMeta({ session: actor, schemaVersion: 'auxiliary-contract-read-v2', operation, dataOrigin: 'real', asOf, coverage: 'unknown', scope, sources: [{ key: 'auxiliary-contracts', state: 'readable', sourceVersion: String(revision), asOf }, { key: 'invoice', state: 'unavailable', sourceVersion: null, asOf: null }, { key: 'payment', state: 'unavailable', sourceVersion: null, asOf: null }, { key: 'settlement', state: actor.capabilities.includes('other-settlement:read') ? 'readable' : 'forbidden', sourceVersion: actor.capabilities.includes('other-settlement:read') ? commandFingerprint(await tx.select('SELECT id,status,total_amount,version FROM expenditure_settlements ORDER BY id')) : null, asOf: actor.capabilities.includes('other-settlement:read') ? asOf : null }] })
  }
  async function financialFacts(tx: TransactionDb, actor: BusinessSession, record: AuxiliaryStoredContract) {
    if (record.draft.kind === 'company_expense' || !actor.capabilities.includes('other-settlement:read'))
      return { facts: [] as AuxiliaryContractFact[], settled: null }
    await validateOtherSettlementJournal(tx, actor)
    const rows = await tx.select<Row>('SELECT id,no,name,total_amount,settlement_date,status,project_id,supplier_id FROM expenditure_settlements WHERE contract_id=? AND deleted_at IS NULL ORDER BY id', [record.draft.id])
    const valid = rows.filter(row => row.project_id === record.draft.projectId && row.supplier_id === record.draft.supplierId)
    const facts: AuxiliaryContractFact[] = valid.map(row => ({ id: String(row.id), contractId: record.draft.id, contractKind: record.draft.kind, dataOrigin: 'real', kind: 'settlement', no: String(row.no ?? ''), name: String(row.name ?? ''), amount: typeof row.total_amount === 'number' ? row.total_amount.toFixed(2) : null, date: row.settlement_date == null ? null : String(row.settlement_date), status: String(row.status), effective: ['confirmed', '已确认'].includes(String(row.status)) }))
    return { facts, settled: valid.length !== rows.length ? null : sumAuxiliaryMoney(facts.filter(row => row.effective).map(row => row.amount)) }
  }
  async function receipt(tx: TransactionDb, actor: BusinessSession, request: Row, action: string, scope: string, result: Row, contractId: string | null) {
    await tx.execute('INSERT INTO auxiliary_contract_receipts VALUES(?,?,?,?,?,?,?,?,?)', [request.commandId, actor.workspaceId, actor.actorId, action, scope, contractId, commandFingerprint(request), JSON.stringify(result), new Date().toISOString()])
  }
  async function remember(session: Session, request: Row, action: string, scope: string, target: string | null) {
    if (!identity(request.commandId))
      return fail('validation-failed', '辅助合同独立原编号无效')
    return run(session, true, async (tx, actor) => {
      if (request.workspaceId !== actor.workspaceId || request.actorId !== actor.actorId)
        return fail('forbidden', '辅助合同原意图与可信身份不同')
      const old = (await tx.select<Row>('SELECT * FROM auxiliary_contract_intents WHERE command_id=?', [request.commandId]))[0]
      const sealed = (await tx.select<Row>('SELECT * FROM auxiliary_contract_resolutions WHERE command_id=?', [request.commandId]))[0]
      if (sealed && (sealed.action !== action || sealed.scope_id !== scope))
        return fail('conflict', '辅助合同原编号已固定另一动作或范围')
      if (old ? old.fingerprint !== commandFingerprint(request) || old.action !== action || old.scope_id !== scope : await legacyCommandExists(tx, String(request.commandId)))
        return fail(old ? 'conflict' : 'unavailable', '辅助合同原编号不能改变原内容或覆盖未知旧历史')
      if (!old)
        await tx.execute('INSERT INTO auxiliary_contract_intents VALUES(?,?,?,?,?,?,?,?,?)', [request.commandId, actor.workspaceId, actor.actorId, action, scope, target, commandFingerprint(request), JSON.stringify(request), new Date().toISOString()])
    }, action !== 'save')
  }
  async function previous(tx: TransactionDb, request: Row) {
    const row = (await tx.select<Row>('SELECT * FROM auxiliary_contract_receipts WHERE command_id=?', [request.commandId]))[0]
    if (row) {
      if (row.fingerprint !== commandFingerprint(request))
        return fail('conflict', '辅助合同原回执对应另一正文')
      return parseJson<Row>(row.result_json)
    }
    if ((await tx.select('SELECT command_id FROM auxiliary_contract_resolutions WHERE command_id=?', [request.commandId]))[0])
      return fail('conflict', '辅助合同原号已封存，不允许迟到提交')
    return null
  }
  async function persistFile(tx: TransactionDb, actor: BusinessSession, headId: string, file: ContractFormAttachment, originalMetadata: Row, bytes: Uint8Array | null, supplementId: string | null = null) {
    const digest = bytes === null ? null : contractOriginalDigest(bytes)
    await tx.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,uploaded_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', [file.id, file.ownerType, file.ownerId, file.fileName, originalMetadata.file_path ?? '', file.fileSize, file.mimeType, file.category, file.uploader, file.uploadedAt ?? '', file.deletedAt])
    if (bytes !== null)
      await tx.execute('INSERT INTO file_payloads VALUES(?,?,?)', [file.id, bytes, digest])
    await tx.execute('INSERT INTO auxiliary_contract_files VALUES(?,?,?,?,?,?,?)', [file.id, headId, supplementId ? 'supplement' : 'head', supplementId, JSON.stringify(originalMetadata), bytes === null ? 'metadata-only' : 'embedded', digest])
  }
  const api = {
    context(session: Session) {
      return run(session, false, async (tx, actor, data) => {
        if (!actor.capabilities.includes('auxiliary-contract:write'))
          return fail('forbidden', '当前辅助合同表单只读')
        const catalog = await owner(tx, actor, data)
        return { ...actor, projects: catalog.projects.map(row => ({ id: row.id, label: row.name })), suppliers: catalog.suppliers.map(row => ({ id: row.id, label: row.name, version: row.version })), constructionMains: await readProductionConstructionMainOptions(tx, actor), ourSignatories: actor.capabilities.includes('our-signatory:read') ? (await readOurSignatories(tx)).records : [] }
      })
    },
    list(input: Row, session: Session) {
      return run(session, false, async (tx, actor, data) => {
        if (input.origin && input.origin !== 'real')
          return fail('forbidden', '正式辅助合同只使用真实来源')
        const { instance } = await owner(tx, actor, data)
        const page = instance.list(input, actor)
        for (const item of page.items) {
          const record = data.state.contracts.find(row => row.draft.id === item.id)!
          const finance = await financialFacts(tx, actor, record)
          Object.assign(item.amounts, { invoiced: null, paid: null, settled: finance.settled, byInvoicePayable: null, bySettlementPayable: null })
          if (!actor.capabilities.includes('project:list:read') && item.project) {
            item.project = { state: 'forbidden', entity: 'project', id: null, label: null, reason: 'permission-denied' }
            item.draft.projectId = null
          }
          if (!actor.capabilities.includes('supplier:list:read') && item.supplier) {
            item.supplier = { state: 'forbidden', entity: 'supplier', id: null, label: null, reason: 'permission-denied' }
            item.draft.supplierId = null
            item.draft.supplierVersion = null
          }
        }
        const proof = await meta(tx, actor, 'auxiliary-contract:list', input, data.state.sourceVersion)
        const demo = createReadMeta({ session: actor, schemaVersion: 'auxiliary-contract-read-v2', operation: 'auxiliary-contract:list', dataOrigin: 'demo', asOf: proof.asOf, coverage: 'unknown', scope: input, sources: [] })
        return withOriginReadMeta(page, { real: proof, demo })
      })
    },
    detail(id: string, input: Row, session: Session): Promise<AuxiliaryContractDetail> {
      return run(session, false, async (tx, actor, data) => {
        if (input.origin && input.origin !== 'real')
          return fail('forbidden', '正式辅助合同不可切换演示源')
        const detail = (await owner(tx, actor, data)).instance.detail(id, input, actor)
        const record = data.state.contracts.find(row => row.draft.id === id)!
        const finance = await financialFacts(tx, actor, record)
        detail.facts.push(...finance.facts)
        Object.assign(detail.contract.amounts, { invoiced: null, paid: null, settled: finance.settled, byInvoicePayable: null, bySettlementPayable: null })
        const relation = record.draft.kind === 'other_expense' ? await readProductionConstructionScopeLink(tx, { domain: 'auxiliary-contract', id }) : null
        const selected = relation?.mainId ? await readProductionConstructionScopeMainFact(tx, actor, relation.mainId) : null
        detail.constructionMain = selected?.projectId ? { id: selected.id, projectId: selected.projectId, basis: selected.basis } : null
        detail.unavailableFactKinds = ['invoice', 'payment', ...(!actor.capabilities.includes('other-settlement:read') && record.draft.kind === 'other_expense' ? ['settlement' as const] : [])]
        const duplicateNumbers = record.draft.no?.trim() ? await tx.select<Row>('SELECT owner_domain,contract_id FROM contract_number_claims WHERE number=?', [record.draft.no.trim()]) : []
        detail.diagnostics = duplicateNumbers.length > 1 ? ['原历史存在同编号的不同真实合同，原编号与文书保留；当前新增正式合同仍须核对唯一编号。'] : []
        if (!actor.capabilities.includes('project:list:read') && detail.contract.project) {
          detail.contract.project = { state: 'forbidden', entity: 'project', id: null, label: null, reason: 'permission-denied' }
          detail.contract.draft.projectId = null
        }
        if (!actor.capabilities.includes('supplier:list:read') && detail.contract.supplier) {
          detail.contract.supplier = { state: 'forbidden', entity: 'supplier', id: null, label: null, reason: 'permission-denied' }
          detail.contract.draft.supplierId = null
          detail.contract.draft.supplierVersion = null
        }
        for (const supplement of data.supplements.filter(row => row.contractId === id && row.deletedAt === null))
          detail.attachments.push(...supplement.attachments.filter(file => (input.includeDeleted === 'true' && actor.capabilities.includes('auxiliary-contract:write')) || file.deletedAt === null))
        return withReadMeta(detail, await meta(tx, actor, 'auxiliary-contract:detail', { ...input, id }, data.state.sourceVersion))
      })
    },
    async execute(input: unknown, session: Session) {
      const request = parseProductionAuxiliaryEnvelope(input)
      const scope = request.id ?? `new-${request.draft.kind}`
      await remember(session, request, 'save', scope, request.id ?? null)
      return run(session, true, async (tx, actor, data) => {
        const old = await previous(tx, request)
        if (old)
          return old as unknown as { id: string, version: string, commandId: string, updatedAt: string, attachmentIds: string[] }
        const command = parseCommand(request)
        if (!command.id && command.draft.kind === 'other_expense' && !command.constructionMain)
          return fail('validation-failed', '新建项目支出合同含草稿必须选择工程名称和真实施工主合同')
        if (command.constructionMain) {
          const main = await readProductionConstructionScopeMainFact(tx, actor, command.constructionMain.id)
          if (!main.eligible || main.basis !== command.constructionMain.basis || main.projectId !== command.constructionMain.projectId || main.projectId !== command.draft.projectId)
            return fail('conflict', '所选工程、施工主合同资格或采用依据已经变化')
        }
        const prior = data.state.contracts.find(row => row.draft.id === command.id)
        if (command.draft.kind === 'company_expense' && (command.draft.supplierId || prior?.draft.supplierId) && !actor.capabilities.includes('supplier:list:read'))
          return fail('forbidden', '无分供方读取权限，不能核对公司合同关系')
        if (prior && (prior.draft.projectId !== command.draft.projectId || prior.draft.supplierId !== command.draft.supplierId || (prior.draft.kind === 'company_expense' && prior.draft.supplierVersion !== command.draft.supplierVersion)) && await consumed(tx, prior.draft.id))
          return fail('relationship-mismatch', '辅助合同已被真实下游、历史或原意图消费，不能改归属')
        const { instance, suppliers } = await owner(tx, actor, data)
        const fileBodies = (command.attachments.add ?? []).map(file => contractOriginalBytes(file, { required: true, fail: message => fail('validation-failed', message) })!)
        const execution = structuredClone(command)
        const originalDraft = execution.draft
        if (originalDraft.kind === 'company_expense') {
          if ((!prior || prior.draft.supplierId) && !originalDraft.supplierId)
            return fail('validation-failed', '公司合同请选择已有分供方')
          if (originalDraft.supplierId) {
            const supplier = suppliers.find(row => row.id === originalDraft.supplierId)
            if (!supplier || !supplier.name.trim())
              return fail('unavailable', '公司合同所选分供方不可读取')
            const unchanged = prior?.draft.supplierId === originalDraft.supplierId && prior.draft.supplierVersion === originalDraft.supplierVersion
            if (!unchanged && supplier.version !== originalDraft.supplierVersion)
              return fail('conflict', '分供方资料已变化，请重新读取并选择')
            execution.draft = { ...originalDraft, counterparty: unchanged ? prior!.draft.counterparty : supplier.name }
          }
        }
        if (!prior && originalDraft.partyA && !originalDraft.ourSignatoryId)
          return fail('validation-failed', '新辅助合同甲方必须从真实我方主档选择，不能自由文本冒名')
        try {
          const adopted = await resolveContractSignatory(tx, { id: originalDraft.ourSignatoryId, version: originalDraft.ourSignatoryVersion, prior: prior?.draft.ourSignatorySnapshot, required: command.action === 'submit' })
          execution.draft = { ...execution.draft, ourSignatoryId: adopted?.id ?? null, ourSignatoryVersion: adopted?.version ?? null, ourSignatorySnapshot: adopted, partyA: adopted?.name ?? originalDraft.partyA }
        }
        catch (cause) {
          if (cause instanceof OurSignatoryRepositoryProblem)
            throw auxiliaryProblem(cause.problem.code, cause.problem.message, cause.problem.fieldErrors)
          throw cause
        }
        const result = await instance.execute(execution, actor)
        const after = instance.exportState().contracts.find(row => row.draft.id === result.id)!
        const newFiles = after.attachments.filter(file => !prior?.attachments.some(row => row.id === file.id))
        newFiles.forEach((file, index) => {
          file.sha256 = contractOriginalDigest(fileBodies[index]!)
        })
        after.facts = prior?.facts ?? []
        const body = JSON.stringify(after)
        await tx.execute('INSERT INTO auxiliary_contract_records VALUES(?,?,?,NULL,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,supplier_id=excluded.supplier_id,record_json=excluded.record_json', [result.id, after.draft.projectId ?? null, after.draft.supplierId ?? null, body])
        for (const file of after.attachments) {
          const previousFile = prior?.attachments.find(row => row.id === file.id)
          if (previousFile) {
            if (previousFile.deletedAt !== file.deletedAt)
              await tx.execute('UPDATE file_refs SET deleted_at=? WHERE id=?', [file.deletedAt, file.id])
          }
          else {
            const index = newFiles.findIndex(row => row.id === file.id)
            await persistFile(tx, actor, result.id, file, { id: file.id, owner_type: file.ownerType, owner_id: result.id, file_name: file.fileName, file_path: '', file_size: file.fileSize, mime_type: file.mimeType }, fileBodies[index]!)
          }
        }
        try {
          await recordContractNumber(tx, { owner: 'auxiliary-contract', id: result.id, number: after.draft.no ?? '', version: result.version, occurredAt: result.updatedAt, formal: !['草稿', 'draft'].includes(after.draft.status ?? '') }, { enforce: command.action === 'submit', historyId: `auxiliary-${result.id}-v${result.version}` })
        }
        catch (cause) {
          if (cause instanceof OurSignatoryRepositoryProblem)
            throw auxiliaryProblem(cause.problem.code, cause.problem.message, cause.problem.fieldErrors)
          throw cause
        }
        await tx.execute('INSERT INTO auxiliary_contract_versions VALUES(?,?,?,?,?,?)', [result.id, after.version, actor.actorId, command.commandId, body, result.updatedAt])
        await tx.execute('UPDATE auxiliary_contract_revision SET revision=revision+1 WHERE singleton=1')
        if (command.constructionMain)
          await appendProductionConstructionScopeBinding(tx, actor, { source: { domain: 'auxiliary-contract', id: result.id }, main: command.constructionMain, original: { family: 'auxiliary-contract', commandId: command.commandId } })
        await receipt(tx, actor, request, 'save', scope, result, result.id)
        return result
      })
    },
    resolve(input: unknown, session: Session) {
      if (!object(input) || Object.keys(input).sort().join(',') !== 'action,actorId,commandId,scopeId,workspaceId' || !identity(input.commandId) || !['save', 'adopt', 'restore'].includes(String(input.action)) || typeof input.scopeId !== 'string' || !input.scopeId)
        return fail('validation-failed', '辅助合同原号核对只接受最小范围定位')
      return run(session, true, async (tx, actor) => {
        if (input.workspaceId !== actor.workspaceId || input.actorId !== actor.actorId)
          return fail('forbidden', '辅助合同原号核对可信身份不同')
        const intent = (await tx.select<Row>('SELECT * FROM auxiliary_contract_intents WHERE command_id=?', [input.commandId]))[0]
        const sealed = (await tx.select<Row>('SELECT * FROM auxiliary_contract_resolutions WHERE command_id=?', [input.commandId]))[0]
        for (const row of [intent, sealed]) {
          if (row && (row.action !== input.action || row.scope_id !== input.scopeId))
            return fail('conflict', '辅助合同原编号已有另一范围或动作')
        }
        const result = (await tx.select<Row>('SELECT result_json FROM auxiliary_contract_receipts WHERE command_id=?', [input.commandId]))[0]
        if (result)
          return { outcome: 'applied' as const, result: parseJson<Row>(result.result_json) }
        if (await legacyCommandExists(tx, String(input.commandId)))
          return fail('unavailable', '辅助合同旧原编号结果仍未知，不能封存或重新发起')
        await tx.execute('INSERT OR IGNORE INTO auxiliary_contract_resolutions VALUES(?,?,?,?,?,?)', [input.commandId, actor.workspaceId, actor.actorId, input.action, input.scopeId, new Date().toISOString()])
        return { outcome: 'not-applied' as const, commandId: String(input.commandId) }
      }, input.action !== 'save')
    },
    file(id: string, fileId: string, session: Session) {
      return run(session, false, async (tx, actor, data) => {
        await api.detailInsideGuard(tx, id)
        const binding = (await tx.select<Row>('SELECT b.*,f.file_name,f.mime_type,f.deleted_at,p.content FROM auxiliary_contract_files b JOIN file_refs f ON f.id=b.file_ref_id LEFT JOIN file_payloads p ON p.file_ref_id=b.file_ref_id WHERE b.contract_id=? AND b.file_ref_id=?', [id, fileId]))[0]
        if (!binding || binding.deleted_at !== null || (binding.owner_kind === 'supplement' && data.supplements.find(row => row.id === binding.supplement_id)?.deletedAt !== null))
          return fail('not-found', '辅助合同或协议原件不属于当前可用目录')
        if (!(binding.content instanceof Uint8Array))
          return fail('unavailable', '历史原件没有完整正文，保留缺件证据')
        return { ownerId: id, fileId, dataOrigin: 'real' as const, fileName: String(binding.file_name), mimeType: String(binding.mime_type), fileSize: binding.content.length, sha256: String(binding.sha256), payloadBase64: Buffer.from(binding.content).toString('base64') }
      })
    },
    async detailInsideGuard(tx: TransactionDb, id: string) {
      if (!(await tx.select('SELECT c.id FROM auxiliary_contract_records c LEFT JOIN projects p ON p.id=c.project_id WHERE c.id=? AND c.deleted_at IS NULL AND p.deleted_at IS NULL', [id]))[0])
        return fail('not-found', '辅助合同所属身份已归档，保留原件和历史')
    },
  }
  return { ...api, ...createMigration({ run, remember, previous, receipt, persistFile, storage }) }
}

async function consumed(tx: ReadTx, id: string) {
  if ((await tx.select('SELECT 1 FROM construction_scope_history WHERE source_domain=\'auxiliary-contract\' AND source_id=?', [id]))[0] || (await tx.select('SELECT command_id FROM construction_scope_intents WHERE json_extract(request_json,\'$.source.domain\')=\'auxiliary-contract\' AND json_extract(request_json,\'$.source.id\')=?', [id]))[0] || (await tx.select('SELECT id FROM expenditure_settlements WHERE contract_id=?', [id]))[0])
    return true
  if ((await tx.select('SELECT name FROM sqlite_schema WHERE type=\'table\' AND name=\'invoices\''))[0]) {
    if ((await tx.select('SELECT id FROM invoices WHERE contract_domain=\'company\' AND contract_id=? LIMIT 1', [id]))[0])
      return true
    if ((await tx.select(`SELECT id FROM invoice_audits
      WHERE (json_extract(before_json,'$.contract.domain')='company' AND json_extract(before_json,'$.contract.id')=?)
         OR (json_extract(after_json,'$.contract.domain')='company' AND json_extract(after_json,'$.contract.id')=?) LIMIT 1`, [id, id]))[0]) {
      return true
    }
  }
  for (const table of ['payment_applications', 'invoice_applications']) {
    const columns = await tx.select<{ name: string }>(`PRAGMA table_info(${table})`)
    for (const foreign of ['contract_id', 'company_expense_contract_id']) {
      if (columns.some(column => column.name === foreign) && (await tx.select(`SELECT id FROM ${table} WHERE ${foreign}=? LIMIT 1`, [id]))[0])
        return true
    }
  }
  for (const table of ['finance_commands', 'other_settlement_commands', 'finance_history', 'other_settlement_history']) {
    if (!(await tx.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=?', [table]))[0])
      continue
    for (const row of await tx.select<Row>(`SELECT * FROM ${table}`)) {
      for (const field of ['request_json', 'snapshot_json']) {
        if (typeof row[field] !== 'string')
          continue
        const value = parseJson<Row>(row[field])
        const references = [value, value.draft, value.head].filter(object)
        if (references.some(reference => reference.contractId === id || reference.companyExpenseContractId === id || reference.contract_id === id || reference.company_expense_contract_id === id))
          return true
      }
    }
  }
  return false
}

function createMigration(context: { run: <T>(session: Session, write: boolean, work: (tx: TransactionDb, actor: BusinessSession, data: Awaited<ReturnType<typeof validateProductionAuxiliaryState>>) => Promise<T>, importing?: boolean) => Promise<T>, remember: (session: Session, request: Row, action: string, scope: string, target: string | null) => Promise<void>, previous: (tx: TransactionDb, request: Row) => Promise<Row | null>, receipt: (tx: TransactionDb, actor: BusinessSession, request: Row, action: string, scope: string, result: Row, contractId: string | null) => Promise<void>, persistFile: (tx: TransactionDb, actor: BusinessSession, headId: string, file: ContractFormAttachment, metadata: Row, bytes: Uint8Array | null, supplementId?: string | null) => Promise<void>, storage: ProductionStorage }) {
  function parse(input: unknown): AuxiliaryImportCommand {
    if (!object(input) || Object.keys(input).sort().join(',') !== 'actorId,commandId,originals,projects,signatories,source,suppliers,workspaceId' || !identity(input.commandId) || !identity(input.workspaceId) || !identity(input.actorId) || !object(input.source) || !hash(input.source.sha256) || typeof input.source.payloadBase64 !== 'string')
      return fail('validation-failed', '辅助合同迁入必须提供完整Native文件、独立原号及明确身份采用')
    for (const name of ['projects', 'suppliers', 'signatories']) {
      const values = input[name]
      if (!Array.isArray(values) || values.some(row => !object(row) || Object.keys(row).sort().join(',') !== 'id,legacyId,version' || typeof row.legacyId !== 'string' || !row.legacyId || !identity(row.id) || typeof row.version !== 'string' || !/^[1-9]\d*$/.test(row.version)) || new Set(values.map(row => row.legacyId)).size !== values.length)
        return fail('validation-failed', '辅助合同的主档采用必须逐项明确稳定ID及真实版本')
    }
    if (!Array.isArray(input.originals) || input.originals.some(row => !object(row) || Object.keys(row).sort().join(',') !== 'fileId,payloadBase64' || typeof row.fileId !== 'string' || !row.fileId || typeof row.payloadBase64 !== 'string' || Buffer.from(row.payloadBase64, 'base64').toString('base64') !== row.payloadBase64) || new Set(input.originals.map(row => row.fileId)).size !== input.originals.length)
      return fail('validation-failed', '辅助合同补传原件缺真实字节或原目录稳定ID')
    return input as unknown as AuxiliaryImportCommand
  }
  const proofFor = (command: AuxiliaryImportCommand) => ({ commandId: command.commandId, workspaceId: command.workspaceId, actorId: command.actorId, sourceSha256: command.source.sha256, projects: command.projects, suppliers: command.suppliers, signatories: command.signatories, originals: command.originals.map(row => ({ fileId: row.fileId, sha256: contractOriginalDigest(Buffer.from(row.payloadBase64, 'base64')) })) })
  async function sourceGraph(native: TransactionDb, proof: { sha256: string, schemaVersion: number }) {
    if (proof.schemaVersion < 47 || proof.schemaVersion > 60)
      return fail('validation-failed', '此辅助合同原库版本尚未核验，保留原文件')
    const projectHeads = await native.select<Row>('SELECT * FROM contracts WHERE kind=\'其他支出\' ORDER BY id')
    const companyHeads = await native.select<Row>('SELECT * FROM company_expense_contracts ORDER BY id')
    if (!projectHeads.length && !companyHeads.length)
      return fail('validation-failed', '完整原库没有辅助合同原图，不采用空领域')
    const supplements = (await native.select<Row>('SELECT * FROM contract_supplements ORDER BY id')).filter(row => projectHeads.some(head => head.id === row.contract_id))
    const files = (await native.select<Row>('SELECT * FROM file_refs WHERE owner_type IN(\'contract\',\'contract_supplement\',\'company_expense_contract\') ORDER BY id')).filter(row => (row.owner_type === 'contract' ? projectHeads : row.owner_type === 'company_expense_contract' ? companyHeads : supplements).some(owner => owner.id === row.owner_id))
    const bodies: Array<{ id: string, body: string | null }> = []
    for (const file of files) {
      const row = (await native.select<Row>('SELECT * FROM file_payloads WHERE file_ref_id=?', [file.id]))[0]
      if (row && (row.encoding !== 'base64' || typeof row.content !== 'string' || Buffer.from(row.content, 'base64').toString('base64') !== row.content))
        return fail('validation-failed', '辅助合同原件的源编码无法完整证明')
      bodies.push({ id: String(file.id), body: row ? String(row.content) : null })
    }
    const projects = (await native.select<Row>('SELECT id,name FROM projects ORDER BY id')).filter(row => projectHeads.some(head => head.project_id === row.id))
    const suppliers = (await native.select<Row>('SELECT id,name FROM suppliers ORDER BY id')).filter(row => projectHeads.some(head => head.supplier_id === row.id))
    const audits = (await native.select<Row>('SELECT * FROM operation_logs ORDER BY id')).filter(row => (row.table_name === 'contracts' ? projectHeads : row.table_name === 'company_expense_contracts' ? companyHeads : row.table_name === 'contract_supplements' ? supplements : row.table_name === 'file_refs' ? files : []).some(owner => owner.id === row.record_id))
    const tables = await native.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\'')
    const selections = [{ table: 'contracts', key: 'id', ids: projectHeads.map(row => String(row.id)) }, { table: 'company_expense_contracts', key: 'id', ids: companyHeads.map(row => String(row.id)) }, { table: 'contract_supplements', key: 'id', ids: supplements.map(row => String(row.id)) }, { table: 'file_refs', key: 'id', ids: files.map(row => String(row.id)) }, { table: 'file_payloads', key: 'file_ref_id', ids: bodies.filter(row => row.body !== null).map(row => row.id) }, { table: 'operation_logs', key: 'id', ids: audits.map(row => String(row.id)) }]
    for (const table of ['auxiliary_contract_intents', 'auxiliary_contract_receipts', 'auxiliary_contract_resolutions', 'auxiliary_contract_versions']) {
      if (!tables.some(row => row.name === table))
        continue
      const columns = await native.select<{ name: string }>(`PRAGMA table_info(${table})`)
      if (columns.some(row => row.name === 'command_id')) {
        const rows = (await native.select<Row>(`SELECT * FROM ${table}`)).filter(row => [...projectHeads, ...companyHeads].some(head => row.contract_id === head.id || row.target_id === head.id || row.id === head.id))
        if (rows.length)
          selections.push({ table, key: 'command_id', ids: rows.map(row => String(row.command_id)) })
      }
    }
    const raw = await captureMigrationDomainRows(native, selections)
    const snapshot = (row: Row) => row.our_signatory_snapshot ? decodeOurSignatorySnapshot(parseJson(row.our_signatory_snapshot)) : null
    const signatories = [...new Map([...projectHeads, ...companyHeads, ...supplements].flatMap((row) => {
      const original = snapshot(row)
      if (original && row.our_signatory_id !== original.id)
        return fail('validation-failed', '辅助合同原主体采用快照与原ID、版本不同')
      return original ? [[`${original.id}@${original.version}`, original] as const] : []
    })).entries()].map(([legacyId, value]) => ({ legacyId, value }))
    return { ...proof, projectHeads, companyHeads, supplements, files, bodies, projects, suppliers, audits, raw, signatories }
  }
  type Source = Awaited<ReturnType<typeof sourceGraph>>
  async function references(tx: TransactionDb, actor: BusinessSession) {
    return { projects: actor.capabilities.includes('project:list:read') ? await tx.select<{ id: string, name: string, version: number, deleted_at: string | null }>('SELECT id,name,version,deleted_at FROM projects ORDER BY id') : [], suppliers: actor.capabilities.includes('supplier:list:read') ? [...(await loadProductionSuppliers(tx, actor)).suppliers.values()].map(row => ({ id: row.id, name: row.draft.name ?? '', version: row.version, deleted_at: null })) : [], signatories: actor.capabilities.includes('our-signatory:read') ? (await readOurSignatories(tx)).records : [] }
  }
  async function withSource<T>(input: unknown, session: Session, write: boolean, work: (source: Source, command: AuxiliaryImportCommand, tx: TransactionDb, actor: BusinessSession) => Promise<T>) {
    const command = parse(input)
    const actor = session()
    if (command.workspaceId !== actor.workspaceId || command.actorId !== actor.actorId || !actor.capabilities.includes('auxiliary-contract:import'))
      return fail('forbidden', '辅助合同来源核验身份或采用权限不同')
    return withVerifiedMigrationSnapshot(command.source, async (native, proof) => {
      const source = await sourceGraph(native, proof)
      return context.run(session, write, (tx, trusted) => work(source, command, tx, trusted), true)
    })
  }
  return {
    importState(session: Session) {
      return context.run(session, false, async (tx, actor) => ({ context: actor, sources: (await tx.select<Row>('SELECT i.id,i.source_sha256,i.result_json,i.created_at,r.restored_at FROM auxiliary_contract_imports i LEFT JOIN auxiliary_contract_import_restores r ON r.import_id=i.id ORDER BY i.created_at,i.id')).map(row => ({ importId: String(row.id), sourceSha256: String(row.source_sha256), ids: parseJson<AuxiliaryImportResult>(row.result_json).ids, supplementIds: parseJson<AuxiliaryImportResult>(row.result_json).supplementIds, importedAt: String(row.created_at), restored: row.restored_at !== null })) }), true)
    },
    preflight(input: unknown, session: Session): Promise<AuxiliaryImportPreview> {
      return withSource(input, session, false, async (source, _command, tx, actor) => {
        const current = await references(tx, actor)
        const contract = (row: Row, kind: 'other_expense' | 'company_expense') => ({ id: String(row.id), kind, name: String(row.name ?? ''), no: String(row.no ?? ''), deletedAt: row.deleted_at == null ? null : String(row.deleted_at) })
        return { sourceSha256: source.sha256, schemaVersion: source.schemaVersion, contracts: [...source.projectHeads.map(row => contract(row, 'other_expense')), ...source.companyHeads.map(row => contract(row, 'company_expense'))], references: [
          ...source.projects.map(row => ({ kind: 'project' as const, id: String(row.id), label: String(row.name), candidates: current.projects.map(candidate => ({ id: candidate.id, label: candidate.name, version: String(candidate.version), deletedAt: candidate.deleted_at })) })),
          ...source.suppliers.map(row => ({ kind: 'supplier' as const, id: String(row.id), label: String(row.name), candidates: current.suppliers.map(candidate => ({ id: candidate.id, label: candidate.name, version: String(candidate.version), deletedAt: candidate.deleted_at })) })),
          ...source.signatories.map(row => ({ kind: 'signatory' as const, id: row.legacyId, label: `${row.value.name} · 原版本 ${row.value.version}`, candidates: current.signatories.flatMap(candidate => candidate.history.filter((history) => {
            const { status: _status, ...facts } = history.draft
            const { id: _id, version: _version, ...original } = row.value
            return isDeepStrictEqual(facts, original)
          }).map(history => ({ id: candidate.id, label: history.draft.name, version: history.version, deletedAt: null }))) })),
        ], requiredOriginals: source.files.filter(file => file.file_path && source.bodies.find(row => row.id === file.id)?.body === null).map(file => ({ id: String(file.id), name: String(file.file_name ?? '') })) }
      })
    },
    async adopt(input: unknown, session: Session): Promise<AuxiliaryImportResult> {
      const command = parse(input)
      const proof = proofFor(command)
      await context.remember(session, proof, 'adopt', command.source.sha256, null)
      return withSource(input, session, true, async (source, command, tx, actor) => {
        const previous = await context.previous(tx, proof)
        if (previous)
          return previous as unknown as AuxiliaryImportResult
        if ((await tx.select('SELECT id FROM auxiliary_contract_imports WHERE source_sha256=?', [source.sha256]))[0])
          return fail('conflict', '同一完整辅助合同原图已经采用，不复制另一套owner')
        const current = await references(tx, actor)
        const map = (kind: 'projects' | 'suppliers', legacyId: unknown) => {
          if (legacyId === null || legacyId === undefined)
            return null
          const mapping = command[kind].find(row => row.legacyId === legacyId)
          const actual = mapping && current[kind].find(row => row.id === mapping.id)
          if (!actual || !mapping || String(actual.version) !== mapping.version)
            return fail('validation-failed', '辅助合同原项目、分供方缺明确采用或当前版本已变化')
          return mapping.id
        }
        if (command.projects.length !== source.projects.length || command.suppliers.length !== source.suppliers.length || command.signatories.length !== source.signatories.length || command.originals.some(row => !source.files.some(file => file.id === row.fileId)))
          return fail('validation-failed', '辅助合同所有主档和原件映射必须恰好属于完整原图')
        const importId = `auxiliary-import-${randomUUID()}`
        const adoptedAt = new Date().toISOString()
        const canonical = new Map<string, string>()
        const safeSourceId = (namespace: string, value: unknown) => identity(value) ? value : `auxiliary-${namespace}-${commandFingerprint([namespace, String(value)]).slice(0, 36)}`
        for (const row of source.projectHeads)
          canonical.set(`other_expense:${row.id}`, safeSourceId('other', row.id))
        for (const row of source.companyHeads) {
          let id = safeSourceId('company', row.id)
          if ([...canonical.values()].includes(id)) {
            const prefixed = `company-expense-${row.id}`
            id = identity(prefixed) && ![...canonical.values()].includes(prefixed) ? prefixed : `auxiliary-company-${commandFingerprint(['company_expense', String(row.id)]).slice(0, 36)}`
          }
          canonical.set(`company_expense:${row.id}`, id)
        }
        for (const row of source.supplements)
          canonical.set(`contract_supplements:${row.id}`, safeSourceId('supplement', row.id))
        for (const row of source.files)
          canonical.set(`file_refs:${row.id}`, safeSourceId('file', row.id))
        if (new Set([...canonical].filter(([key]) => /^(?:other_expense|company_expense):/.test(key)).map(([, id]) => id)).size !== source.projectHeads.length + source.companyHeads.length)
          return fail('validation-failed', '辅助合同不同原表的稳定身份无法安全隔离，不能按同ID合并')
        const signatory = (row: Row) => {
          if (!row.our_signatory_snapshot)
            return null
          const original = decodeOurSignatorySnapshot(parseJson(row.our_signatory_snapshot))
          const mapping = command.signatories.find(entry => entry.legacyId === `${original.id}@${original.version}`)
          const actual = mapping && current.signatories.find(entry => entry.id === mapping.id)?.history.find(entry => entry.version === mapping.version)
          if (!mapping || !actual)
            return fail('validation-failed', '辅助合同原主体版本缺明确正式历史映射')
          const { status: _status, ...facts } = actual.draft
          const { id: _id, version: _version, ...old } = original
          if (!isDeepStrictEqual(facts, old))
            return fail('validation-failed', '辅助合同原文书主体事实与正式历史不同，不能改名冒用')
          return { id: mapping.id, version: mapping.version, ...facts }
        }
        const heads: Array<{ record: AuxiliaryStoredContract, original: Row }> = []
        for (const [kind, rows] of [['other_expense', source.projectHeads], ['company_expense', source.companyHeads]] as const) {
          for (const original of rows) {
            const id = canonical.get(`${kind}:${original.id}`)!
            if ((await tx.select('SELECT id FROM auxiliary_contract_records WHERE id=?', [id]))[0])
              return fail('conflict', '辅助合同原稳定ID已有事实，不静默合并同名合同')
            const converted = auxiliaryContractSourceEntity({ ...original, auxiliary_kind: kind, category: kind === 'other_expense' ? original.other_expense_kind : original.category, files_json: '[]', facts_json: '[]' })
            const record = migratedAuxiliaryContract({ ...converted, id, batchId: importId, entityType: 'auxiliary_contracts', name: converted.name ?? '', references: kind === 'other_expense' ? { projectId: map('projects', original.project_id), supplierId: map('suppliers', original.supplier_id) } : {}, amount: converted.amount ?? null, quantity: null, attributes: converted.attributes ?? {}, deletedAt: converted.deletedAt ?? null }, importId)
            record.workspaceId = actor.workspaceId
            const adopted = signatory(original)
            if (adopted)
              record.draft = { ...record.draft, ourSignatoryId: adopted.id, ourSignatoryVersion: adopted.version, ourSignatorySnapshot: adopted, partyA: adopted.name }
            heads.push({ record, original })
            await tx.execute('INSERT INTO auxiliary_contract_records VALUES(?,?,?,?,?)', [id, record.draft.projectId ?? null, record.draft.supplierId ?? null, original.deleted_at ?? null, JSON.stringify(record)])
          }
        }
        const supplements = source.supplements.map((original) => {
          const id = canonical.get(`contract_supplements:${original.id}`)!
          const contractId = canonical.get(`other_expense:${original.contract_id}`)!
          const fact: AuxiliaryContractFact & { deletedAt: string | null, attachments: ContractFormAttachment[], ourSignatorySnapshot: ReturnType<typeof signatory> } = { id, contractId, contractKind: 'other_expense', dataOrigin: 'real', kind: 'supplement', name: String(original.name ?? ''), no: String(original.no ?? ''), amount: original.amount === null ? null : Number(original.amount).toFixed(2), date: original.sign_date == null ? null : String(original.sign_date), status: String(original.status ?? ''), effective: isEffectiveExpenditureContract(String(original.status ?? '')), deletedAt: original.deleted_at == null ? null : String(original.deleted_at), attachments: [], ourSignatorySnapshot: signatory(original) }
          return { fact, original }
        })
        for (const row of supplements)
          await tx.execute('INSERT INTO auxiliary_contract_supplements VALUES(?,?,?)', [row.fact.id, row.fact.contractId, JSON.stringify(row.fact)])
        for (const original of source.files) {
          const supplement = original.owner_type === 'contract_supplement' ? supplements.find(row => row.original.id === original.owner_id) : null
          const headId = supplement?.fact.contractId ?? canonical.get(`${original.owner_type === 'company_expense_contract' ? 'company_expense' : 'other_expense'}:${original.owner_id}`)!
          const head = heads.find(row => row.record.draft.id === headId)!
          const payload = source.bodies.find(row => row.id === original.id)!.body ?? command.originals.find(row => row.fileId === original.id)?.payloadBase64 ?? null
          if (payload === null && original.file_path)
            return fail('validation-failed', '辅助合同路径原件须按原目录ID补齐，不能声明已上传或静默缺件')
          const bytes = payload === null ? null : Buffer.from(payload, 'base64')
          if (bytes !== null && (bytes.toString('base64') !== payload || (original.file_size !== null && original.file_size !== bytes.length)))
            return fail('validation-failed', '辅助合同原件的实际字节、原大小或编码不同')
          const file: ContractFormAttachment = { id: canonical.get(`file_refs:${original.id}`)!, ownerId: supplement?.fact.id ?? headId, ownerType: supplement ? 'contract_supplement' : head.record.draft.kind === 'company_expense' ? 'company_expense_contract' : 'contract', fileName: String(original.file_name ?? ''), filePath: '', fileSize: bytes?.length ?? Number(original.file_size ?? 0), mimeType: String(original.mime_type ?? ''), category: String(original.category ?? ''), uploader: String(original.uploader ?? ''), uploadedAt: original.uploaded_at === null ? null : String(original.uploaded_at ?? ''), deletedAt: original.deleted_at == null ? null : String(original.deleted_at), ...(bytes ? { sha256: contractOriginalDigest(bytes) } : {}) }
          const metadata = { ...original, adopted_file_ref_id: file.id, adopted_owner_id: file.ownerId, adopted_contract_id: headId }
          await context.persistFile(tx, actor, headId, file, metadata, bytes, supplement?.fact.id ?? null)
          if (supplement)
            supplement.fact.attachments.push(file)
          else head.record.attachments.push(file)
        }
        for (const row of supplements)
          await tx.execute('UPDATE auxiliary_contract_supplements SET record_json=? WHERE id=?', [JSON.stringify(row.fact), row.fact.id])
        const installed: Record<string, string> = {}
        for (const { record, original } of heads) {
          const body = JSON.stringify(record)
          const timestamp = time(record.audit.updatedAt) ? record.audit.updatedAt! : adoptedAt
          await tx.execute('UPDATE auxiliary_contract_records SET record_json=? WHERE id=?', [body, record.draft.id])
          await tx.execute('INSERT INTO auxiliary_contract_versions VALUES(?,?,?,?,?,?)', [record.draft.id, 1, actor.actorId, command.commandId, body, timestamp])
          const number = record.draft.no?.trim() ?? ''
          if (number) {
            await tx.execute('INSERT INTO contract_number_history VALUES(?,?,?,?,?,?,?)', [`auxiliary-${record.draft.id}-v1`, 'auxiliary-contract', record.draft.id, number, '1', timestamp, 'migration-evidence'])
            if (!['草稿', 'draft'].includes(record.draft.status ?? ''))
              await tx.execute('INSERT INTO contract_number_claims VALUES(?,?,?,?,?)', ['auxiliary-contract', record.draft.id, number, '1', timestamp])
          }
          installed[record.draft.id] = commandFingerprint({ id: record.draft.id, project_id: record.draft.projectId ?? null, supplier_id: record.draft.supplierId ?? null, deleted_at: original.deleted_at ?? null, record_json: body })
        }
        const rawDomain = { ...source.raw.rows, file_payloads: source.raw.rows.file_payloads!.map(row => ({ ...row, columns: { ...row.columns, content: { sqliteType: row.columns.content!.sqliteType, sharedOriginal: canonical.get(`file_refs:${row.legacyId}`), sha256: contractOriginalDigest(Buffer.from(source.bodies.find(body => body.id === row.legacyId)!.body!, 'base64')) } } })) }
        const result: AuxiliaryImportResult = { commandId: command.commandId, importId, sourceSha256: source.sha256, ids: heads.map(row => row.record.draft.id), supplementIds: supplements.map(row => row.fact.id) }
        const evidence = { sourceSha256: source.sha256, schemaVersion: source.schemaVersion, adoptedAt, requestFingerprint: commandFingerprint(proof), references: { projects: command.projects, suppliers: command.suppliers, signatories: command.signatories }, identityMappings: [...canonical].map(([legacyId, id]) => ({ legacyId, id })), rawDomain, sourceSchemas: source.raw.schemas, domainDigest: commandFingerprint(rawDomain), installed, supplements: supplements.map(row => row.fact) }
        await tx.execute('INSERT INTO auxiliary_contract_imports VALUES(?,?,?,?,?,?,?,?,?)', [importId, actor.workspaceId, actor.actorId, command.commandId, source.sha256, JSON.stringify(evidence), commandFingerprint(evidence), JSON.stringify(result), adoptedAt])
        await context.receipt(tx, actor, proof, 'adopt', source.sha256, result as unknown as Row, null)
        await tx.execute('UPDATE auxiliary_contract_revision SET revision=revision+? WHERE singleton=1', [heads.length])
        return result
      })
    },
    async restore(input: unknown, session: Session): Promise<AuxiliaryImportResult> {
      if (!object(input) || Object.keys(input).sort().join(',') !== 'actorId,commandId,importId,workspaceId' || !identity(input.commandId) || !identity(input.importId))
        return fail('validation-failed', '辅助合同整批恢复必须提供原批次和独立原号')
      await context.remember(session, input, 'restore', String(input.importId), null)
      return context.run(session, true, async (tx, actor, data) => {
        const old = await context.previous(tx, input)
        if (old)
          return old as unknown as AuxiliaryImportResult
        const imported = data.imports.find(row => row.id === input.importId)
        if (!imported || data.restores.some(row => row.import_id === input.importId))
          return fail('conflict', '辅助合同原批次不存在或已经恢复')
        const evidence = parseJson<{ installed: Record<string, string>, supplements: Array<{ id: string }> }>(imported.evidence_json)
        const originalResult = parseJson<AuxiliaryImportResult>(imported.result_json)
        for (const id of originalResult.ids) {
          const current = (await tx.select<Row>('SELECT id,project_id,supplier_id,deleted_at,record_json FROM auxiliary_contract_records WHERE id=?', [id]))[0]
          if (!current || commandFingerprint(current) !== evidence.installed[id] || (await tx.select('SELECT command_id FROM auxiliary_contract_intents WHERE target_id=?', [id]))[0] || await consumed(tx, id))
            return fail('conflict', '辅助合同整批危险恢复拒绝：后来修改、原意图、真实下游或历史已经消费')
        }
        const supplements = data.supplements.filter(row => originalResult.supplementIds.includes(row.id))
        if (supplements.length !== evidence.supplements.length || supplements.some(row => !isDeepStrictEqual(row, evidence.supplements.find(original => original.id === row.id))))
          return fail('conflict', '辅助合同整批危险恢复拒绝：原协议或附件已有变化')
        const restoredAt = new Date().toISOString()
        await tx.execute('UPDATE auxiliary_contract_records SET deleted_at=? WHERE json_extract(record_json,\'$.migrationBatchId\')=?', [restoredAt, input.importId])
        const result: AuxiliaryImportResult = { ...originalResult, commandId: String(input.commandId), restored: true }
        await tx.execute('INSERT INTO auxiliary_contract_import_restores VALUES(?,?,?,?,?,?)', [input.importId, actor.workspaceId, actor.actorId, input.commandId, JSON.stringify(result), restoredAt])
        await context.receipt(tx, actor, input, 'restore', String(input.importId), result as unknown as Row, null)
        await tx.execute('UPDATE auxiliary_contract_revision SET revision=revision+1 WHERE singleton=1')
        return result
      }, true)
    },
  }
}
