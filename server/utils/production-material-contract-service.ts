import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { SourceEvidenceDTO } from '../../app/types/read-model'
import type { BusinessSession } from './business-session'
import type { MaterialContractOwnerSnapshot, StoredMaterialContract } from './material-contract-command-test-instance'
import type { ProductionStorage } from './production-storage'
import { Buffer } from 'node:buffer'
import { isDeepStrictEqual } from 'node:util'
import { buildContractPriceFacts } from '../../app/lib/material-contract/price-facts'
import { buildMaterialContractDetail, buildMaterialContractListPage, materialContractProblem, MaterialContractRepositoryProblem, parseMaterialContractDetailQuery, parseMaterialContractListQuery } from '../../app/lib/material-contract/repository'
import { OurSignatoryRepositoryProblem } from '../../app/lib/our-signatory/contract'
import { contractNumberConflict, recordContractNumber } from '../../app/lib/our-signatory/number-registry'
import { readOurSignatories, resolveContractSignatory } from '../../app/lib/our-signatory/storage'
import { validateMaterialContractIdentities } from './contract-identity-evidence'
import { parseMaterialContractCommandRequest } from './material-contract-command-request'
import { createMaterialContractCommandTestInstance } from './material-contract-command-test-instance'
import { materialOriginalBytes, materialOriginalDigest } from './material-contract-original'
import { createReadMeta, readQueryScope, withOriginReadMeta, withReadMeta } from './read-meta'

type Session = () => BusinessSession
function fail(code: 'forbidden' | 'validation-failed' | 'unavailable', message: string): never {
  throw new MaterialContractRepositoryProblem(materialContractProblem(code, message))
}
function scopedKey(key: string, actor: BusinessSession): string {
  const parts: unknown = JSON.parse(key)
  if (!Array.isArray(parts) || parts.length !== 4 || parts[0] !== actor.workspaceId || parts[1] !== actor.actorId || parts[2] !== 'material-contract' || typeof parts[3] !== 'string' || !parts[3])
    return fail('unavailable', '材采持久命令作用域与正式身份不一致。')
  return parts[3]
}

async function load(tx: TransactionDb, actor: BusinessSession): Promise<MaterialContractOwnerSnapshot> {
  const records = await tx.select<{ id: string, parent_id: string | null, project_id: string | null, supplier_id: string | null, record_json: string }>('SELECT * FROM material_contract_records')
  const commands = await tx.select<{ scoped_id: string, command_id: string, fingerprint: string, request_json: string, result_json: string | null }>('SELECT * FROM material_contract_commands')
  const sealed = await tx.select<{ scoped_id: string }>('SELECT scoped_id FROM material_contract_resolutions')
  const revisions = await tx.select<{ revision: number }>('SELECT revision FROM material_contract_revision WHERE singleton=1')
  const contracts = records.map((record) => {
    const row = JSON.parse(record.record_json) as StoredMaterialContract
    if (row.id !== record.id || (row.draft.isSupplement ? row.draft.originalContractId : null) !== record.parent_id || (row.draft.projectId ?? null) !== record.project_id || (row.draft.supplierId ?? null) !== record.supplier_id)
      fail('unavailable', '材采持久关系列与记录证据不一致，停止读取。')
    return row
  })
  await validateMaterialContractIdentities(tx, contracts)
  for (const contract of contracts) {
    for (const attachment of contract.attachments) {
      if (!attachment.sha256)
        continue
      const rows = await tx.select<{ owner_type: string, owner_id: string, file_name: string, file_size: number, mime_type: string, deleted_at: string | null, content: Uint8Array, sha256: string }>('SELECT f.*,p.content,p.sha256 FROM file_refs f LEFT JOIN file_payloads p ON p.file_ref_id=f.id WHERE f.id=?', [attachment.id])
      const row = rows[0]
      if (!row || row.owner_type !== attachment.ownerType || row.owner_id !== contract.id || row.file_name !== attachment.fileName || row.file_size !== attachment.fileSize || row.mime_type !== attachment.mimeType
        || row.deleted_at !== attachment.deletedAt || !(row.content instanceof Uint8Array) || row.content.length !== attachment.fileSize || row.sha256 !== attachment.sha256 || materialOriginalDigest(row.content) !== attachment.sha256) {
        fail('unavailable', '材采原件正文、归属或摘要损坏；不能把已存原件当作历史缺件。')
      }
    }
  }
  for (const row of commands) {
    if (scopedKey(row.scoped_id, actor) !== row.command_id)
      fail('unavailable', '材采持久回执身份不一致。')
  }
  for (const row of sealed)
    scopedKey(row.scoped_id, actor)
  return {
    schemaVersion: 1,
    sourceVersion: revisions[0]?.revision ?? fail('unavailable', '材采持久版本记录缺失。'),
    contracts,
    commands: commands.flatMap(row => row.result_json == null ? [] : [[row.scoped_id, JSON.parse(row.result_json)] as MaterialContractOwnerSnapshot['commands'][number]]),
    commandFingerprints: commands.map(row => [row.scoped_id, row.fingerprint]),
    requestEvidence: commands.map(row => [row.scoped_id, JSON.parse(row.request_json)]),
    sealedCommands: sealed.map(row => row.scoped_id),
  }
}

/** Called by another owner only inside its existing trusted, consistent transaction. */
export async function readMaterialContractProjectFacts(tx: TransactionDb, actor: BusinessSession, projectId: string, asOf: string): Promise<{ count: number | null, source: SourceEvidenceDTO }> {
  if (!actor.capabilities.includes('material-contract:read'))
    return { count: null, source: { key: 'material-contracts', state: 'forbidden', sourceVersion: null, asOf: null } }
  const snapshot = await load(tx, actor)
  const owner = createMaterialContractCommandTestInstance()
  owner.importState(snapshot)
  return { count: owner.rows().filter(row => row.projectId === projectId).length, source: { key: 'material-contracts', state: 'readable', sourceVersion: owner.sourceVersion(), asOf } }
}

/** Same owner journal and transaction; the consumer keeps contract qualification separate from historical cost facts. */
export async function readMaterialContractSupplierFacts(tx: TransactionDb, actor: BusinessSession, supplierId: string | undefined, asOf: string): Promise<{ records: StoredMaterialContract[] | null, source: SourceEvidenceDTO }> {
  if (!actor.capabilities.includes('material-contract:read'))
    return { records: null, source: { key: 'material-contracts', state: 'forbidden', sourceVersion: null, asOf: null } }
  const snapshot = await load(tx, actor)
  const owner = createMaterialContractCommandTestInstance()
  owner.importState(snapshot)
  return { records: supplierId === undefined ? snapshot.contracts : snapshot.contracts.filter(row => row.draft.supplierId === supplierId), source: { key: 'material-contracts', state: 'readable', sourceVersion: owner.sourceVersion(), asOf } }
}

async function save(tx: TransactionDb, before: MaterialContractOwnerSnapshot, after: MaterialContractOwnerSnapshot, actor: BusinessSession) {
  if (before.contracts.some(row => !after.contracts.some(current => current.id === row.id)) || before.commands.some(([key]) => !after.commands.some(([current]) => current === key)) || before.sealedCommands.some(key => !after.sealedCommands.includes(key)))
    fail('unavailable', '不能删除材采合同历史、原回执或封存记录。')
  for (const row of after.contracts) {
    if (isDeepStrictEqual(row, before.contracts.find(prior => prior.id === row.id)))
      continue
    await tx.execute(`INSERT INTO material_contract_records VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id, project_id=excluded.project_id, supplier_id=excluded.supplier_id, record_json=excluded.record_json`, [row.id, row.draft.isSupplement ? row.draft.originalContractId : null, row.draft.projectId ?? null, row.draft.supplierId ?? null, JSON.stringify(row)])
    if (!row.draft.isSupplement) {
      try {
        await recordContractNumber(tx, { owner: 'material-contracts', id: row.id, number: row.draft.no ?? '', version: String(row.version), occurredAt: row.updatedAt, formal: !['draft', '草稿'].includes(row.draft.status ?? '') }, { enforce: true, historyId: `material-${row.id}-v${row.version}` })
      }
      catch (cause) {
        if (cause instanceof OurSignatoryRepositoryProblem)
          throw new MaterialContractRepositoryProblem(cause.problem)
        throw cause
      }
    }
  }
  const service = createMaterialContractCommandTestInstance()
  service.importState(after)
  for (const row of after.contracts) {
    const prior = before.contracts.find(contract => contract.id === row.id)
    for (const attachment of row.attachments) {
      if (!attachment.sha256)
        continue
      const old = prior?.attachments.find(file => file.id === attachment.id)
      if (old) {
        if (old.sha256 !== attachment.sha256 || old.fileName !== attachment.fileName || old.fileSize !== attachment.fileSize || old.ownerType !== attachment.ownerType)
          fail('unavailable', '材采原件身份和正文不可覆盖。')
        if (old.deletedAt !== attachment.deletedAt)
          await tx.execute('UPDATE file_refs SET deleted_at=? WHERE id=?', [attachment.deletedAt, attachment.id])
      }
      else {
        const original = service.file(row.id, attachment.id, actor)
        await tx.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,uploaded_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', [attachment.id, attachment.ownerType, row.id, attachment.fileName, attachment.filePath, attachment.fileSize, attachment.mimeType, attachment.category, attachment.uploader, attachment.uploadedAt, attachment.deletedAt])
        await tx.execute('INSERT INTO file_payloads(file_ref_id,content,sha256) VALUES(?,?,?)', [attachment.id, Buffer.from(original.bytes), original.sha256])
      }
    }
  }
  const resultByKey = new Map(after.commands)
  const fingerprintByKey = new Map(after.commandFingerprints)
  for (const [key, request] of after.requestEvidence) {
    const oldRequest = before.requestEvidence.find(([current]) => current === key)?.[1]
    const oldResult = before.commands.find(([current]) => current === key)?.[1]
    const result = resultByKey.get(key) ?? null
    if (oldRequest && (!isDeepStrictEqual(oldRequest, request) || (oldResult && !isDeepStrictEqual(oldResult, result))))
      fail('unavailable', '材采原提交证据和回执不可覆盖。')
    await tx.execute(`INSERT INTO material_contract_commands VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(scoped_id) DO UPDATE SET result_json=excluded.result_json,contract_id=excluded.contract_id`, [key, scopedKey(key, actor), actor.workspaceId, actor.actorId, fingerprintByKey.get(key), JSON.stringify(request), result ? JSON.stringify(result) : null, result?.id ?? null])
  }
  for (const key of after.sealedCommands) {
    if (!before.sealedCommands.includes(key))
      await tx.execute('INSERT INTO material_contract_resolutions VALUES(?,?,?,?,?)', [key, scopedKey(key, actor), actor.workspaceId, actor.actorId, new Date().toISOString()])
  }
  await tx.execute('UPDATE material_contract_revision SET revision=? WHERE singleton=1', [after.sourceVersion])
}

/** 每次操作从同一磁盘事务读取 owner；内存实例仅为事务内计算快照。 */
export function createProductionMaterialContractService(storage: ProductionStorage) {
  function authorize(session: Session, write: boolean) {
    const actor = session()
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !actor.capabilities.includes('material-contract:read') || (write && !actor.capabilities.includes('material-contract:write')))
      fail('forbidden', '当前会话无此工作区的材料采购合同权限。')
    return actor
  }
  async function run<T>(session: Session, write: boolean, operation: (service: ReturnType<typeof createMaterialContractCommandTestInstance>, actor: BusinessSession, tx: TransactionDb) => T | Promise<T>): Promise<T> {
    const actor = authorize(session, write)
    if (write)
      storage.assertBusinessWrite()
    const completed = await storage.withTransaction(async (tx) => {
      authorize(session, write)
      let before: MaterialContractOwnerSnapshot
      try {
        before = await load(tx, actor)
      }
      catch { return fail('unavailable', '材采持久快照结构或原件证据损坏，停止读取。') }
      const projects = actor.capabilities.includes('project:list:read') ? await tx.select<{ id: string, name: string }>('SELECT id,name FROM projects WHERE deleted_at IS NULL') : []
      const suppliers = actor.capabilities.includes('supplier:list:read') ? await tx.select<{ id: string, draft_json: string }>('SELECT id,draft_json FROM suppliers') : []
      const service = createMaterialContractCommandTestInstance({ projects, suppliers: suppliers.map(row => ({ id: row.id, name: String(JSON.parse(row.draft_json).name ?? '') })), resolveSignatory: async (draft, existing, required) => {
        try {
          return await resolveContractSignatory(tx, { id: draft.ourSignatoryId, version: draft.ourSignatoryVersion, prior: existing?.draft.ourSignatorySnapshot, required })
        }
        catch (cause) {
          if (cause instanceof OurSignatoryRepositoryProblem)
            throw new MaterialContractRepositoryProblem(cause.problem)
          throw cause
        }
      }, numberConflict: (number, id) => contractNumberConflict(tx, 'material-contracts', id, number) })
      try {
        service.importState(before)
      }
      catch { return fail('unavailable', '材采持久历史、原命令或归属结构损坏，停止读取。') }
      let result: T | undefined
      let rejected: MaterialContractRepositoryProblem | undefined
      try {
        result = await operation(service, actor, tx)
      }
      catch (cause) {
        // 业务拒绝仍固定原规范请求；数据库故障、撤权和未知失败继续撤回整个事务。
        if (!write || !(cause instanceof MaterialContractRepositoryProblem) || !['validation-failed', 'conflict', 'not-found'].includes(cause.problem.code))
          throw cause
        rejected = cause
      }
      const after = service.exportState()
      if (!isDeepStrictEqual(before, after)) {
        if (!write)
          fail('unavailable', '材采只读投影改变持久事实，停止操作。')
        storage.assertBusinessWrite()
        await save(tx, before, after, actor)
      }
      if (!isDeepStrictEqual(authorize(session, write), actor))
        fail('forbidden', '操作期间会话或权限改变，本次事务已撤回。')
      return { result, rejected }
    })
    if (completed.rejected)
      throw completed.rejected
    return completed.result as T
  }
  async function readSources(tx: TransactionDb, ownerVersion: string, actor: BusinessSession, asOf: string): Promise<SourceEvidenceDTO[]> {
    const [project, supplier] = await Promise.all([
      tx.select<{ revision: number }>('SELECT revision FROM project_revision WHERE singleton=1'),
      tx.select<{ revision: number }>('SELECT revision FROM supplier_revision WHERE singleton=1'),
    ])
    if (project.length !== 1 || supplier.length !== 1 || [project[0]?.revision, supplier[0]?.revision].some(value => !Number.isSafeInteger(value) || Number(value) < 0))
      fail('unavailable', '材采关联来源的版本依据缺失，停止读取。')
    return [
      { key: 'material-contracts', state: 'readable', sourceVersion: ownerVersion, asOf },
      { key: 'projects', state: actor.capabilities.includes('project:list:read') ? 'readable' : 'forbidden', sourceVersion: actor.capabilities.includes('project:list:read') ? `project-${project[0]!.revision}` : null, asOf: actor.capabilities.includes('project:list:read') ? asOf : null },
      { key: 'suppliers', state: actor.capabilities.includes('supplier:list:read') ? 'readable' : 'forbidden', sourceVersion: actor.capabilities.includes('supplier:list:read') ? `supplier-${supplier[0]!.revision}` : null, asOf: actor.capabilities.includes('supplier:list:read') ? asOf : null },
      { key: 'material-finance', state: 'unavailable', sourceVersion: null, asOf: null },
    ]
  }
  function readableRows(service: ReturnType<typeof createMaterialContractCommandTestInstance>, actor: BusinessSession) {
    return service.rows().map(row => ({ ...row, financialReadStatus: 'unavailable' as const, projectReferenceState: actor.capabilities.includes('project:list:read') ? row.projectReferenceState : 'forbidden' as const, supplierReferenceState: actor.capabilities.includes('supplier:list:read') ? row.supplierReferenceState : 'forbidden' as const }))
  }
  return {
    prices(origin: string, session: Session) {
      return run(session, false, async (service, actor, tx) => {
        if (origin !== 'real')
          fail('forbidden', '正式合同约定价不接受其他数据来源。')
        const asOf = new Date().toISOString()
        const meta = createReadMeta({ session: actor, schemaVersion: 'material-contract-prices-v1', operation: 'material-contract:prices', dataOrigin: 'real', asOf, scope: { origin }, coverage: 'complete', sources: await readSources(tx, service.sourceVersion(), actor, asOf) })
        return withReadMeta({ ...meta, dataOrigin: 'real' as const, items: buildContractPriceFacts(readableRows(service, actor), service.facts()) }, meta)
      })
    },
    async execute(body: unknown, session: Session, id?: string) {
      const request = parseMaterialContractCommandRequest(body, id ? { kind: 'update', routeId: id } : { kind: 'create' })
      for (const file of request.attachments.add ?? [])
        materialOriginalBytes(file, true)
      return run(session, true, (service, actor) => service.execute(request, actor))
    },
    resolve(commandId: string, session: Session) {
      return run(session, true, (service, actor) => service.resolve(commandId, actor))
    },
    form(id: string, session: Session) {
      return run(session, false, (service, actor) => service.form(id, actor))
    },
    context(session: Session) {
      return run(session, false, async (service, actor, tx) => {
        if (!actor.capabilities.includes('material-contract:write'))
          fail('forbidden', '无材料采购合同表单操作权限。')
        const context = service.formContext()
        return { workspaceId: actor.workspaceId, actorId: actor.actorId, capabilities: [...actor.capabilities], projects: context.projects.map(row => ({ id: row.id, label: row.name })), suppliers: context.suppliers.map(row => ({ id: row.id, label: row.name })), originalContracts: context.originalContracts, ourSignatories: actor.capabilities.includes('our-signatory:read') ? (await readOurSignatories(tx)).records : [] }
      })
    },
    list(input: Record<string, unknown>, session: Session) {
      return run(session, false, async (service, actor, tx) => {
        const query = parseMaterialContractListQuery(input)
        if (query.includeDemo || (query.origin && query.origin !== 'real'))
          fail('forbidden', '正式材采来源不接受测试数据。')
        const asOf = new Date().toISOString()
        const sources = await readSources(tx, service.sourceVersion(), actor, asOf)
        const create = (dataOrigin: 'real' | 'demo') => createReadMeta({ session: actor, schemaVersion: 'material-contract-read-v2', operation: 'material-contract:list', dataOrigin, asOf, scope: readQueryScope(query as unknown as Record<string, unknown>), coverage: dataOrigin === 'real' ? 'complete' : 'unknown', sources: dataOrigin === 'real' ? sources : [{ key: 'material-demo', state: 'not-requested', sourceVersion: null, asOf: null }] })
        const originMeta = { real: create('real'), demo: create('demo') }
        return withOriginReadMeta(buildMaterialContractListPage({ contracts: readableRows(service, actor), query, ...originMeta.real }), originMeta)
      })
    },
    detail(id: string, input: Record<string, unknown>, session: Session) {
      return run(session, false, async (service, actor, tx) => {
        const query = parseMaterialContractDetailQuery(id, input)
        if (query.origin !== 'real' || query.includeDemo)
          fail('forbidden', '正式材采来源不接受测试数据。')
        const asOf = new Date().toISOString()
        const meta = createReadMeta({ session: actor, schemaVersion: 'material-contract-read-v2', operation: 'material-contract:detail', dataOrigin: 'real', asOf, scope: query, coverage: 'complete', sources: await readSources(tx, service.sourceVersion(), actor, asOf) })
        return withReadMeta(buildMaterialContractDetail({ contracts: readableRows(service, actor), facts: service.facts(), query, ...meta }), meta)
      })
    },
    snapshot(session: Session) {
      return run(session, false, service => service.exportState())
    },
    file(id: string, fileId: string, session: Session) {
      return run(session, false, async (service, actor, tx) => {
        const metadata = service.exportState().contracts.find(contract => contract.id === id)?.attachments.find(file => file.id === fileId && file.deletedAt === null && file.ownerId === id)
        if (!metadata || !metadata.sha256)
          throw new MaterialContractRepositoryProblem(materialContractProblem('not-found', '此附件未保存可读取的原件正文。'))
        const rows = await tx.select<{ content: Uint8Array, sha256: string }>('SELECT p.content,p.sha256 FROM file_payloads p JOIN file_refs f ON f.id=p.file_ref_id WHERE f.id=? AND f.owner_type=? AND f.owner_id=? AND f.deleted_at IS NULL', [fileId, metadata.ownerType, id])
        const row = rows[0]
        if (!row || row.sha256 !== metadata.sha256 || materialOriginalDigest(row.content) !== metadata.sha256 || row.content.length !== metadata.fileSize)
          fail('unavailable', '材料合同原件证据不完整，请核对备份。')
        return { bytes: row.content, sha256: row.sha256, fileName: metadata.fileName, mimeType: metadata.mimeType }
      })
    },
  }
}
