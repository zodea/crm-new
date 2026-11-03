import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { SourceEvidenceDTO } from '../../app/types/read-model'
import type { BusinessSession } from './business-session'
import type { MaterialContractOwnerSnapshot, StoredMaterialContract } from './material-contract-command-test-instance'
import type { ProductionStorage } from './production-storage'
import { Buffer } from 'node:buffer'
import { isDeepStrictEqual } from 'node:util'
import { FinanceRepositoryProblem } from '../../app/lib/finance/central-contract'
import { buildContractPriceFacts } from '../../app/lib/material-contract/price-facts'
import { buildMaterialContractDetail, buildMaterialContractListPage, materialContractProblem, MaterialContractRepositoryProblem, parseMaterialContractDetailQuery, parseMaterialContractListQuery } from '../../app/lib/material-contract/repository'
import { OurSignatoryRepositoryProblem } from '../../app/lib/our-signatory/contract'
import { contractNumberConflict, recordContractNumber } from '../../app/lib/our-signatory/number-registry'
import { readOurSignatories, resolveContractSignatory } from '../../app/lib/our-signatory/storage'
import { commandFingerprint } from './command-journal'
import { parseMaterialContractCommandRequest } from './material-contract-command-request'
import { createMaterialContractCommandTestInstance } from './material-contract-command-test-instance'
import { materialOriginalBytes, materialOriginalDigest } from './material-contract-original'
import { materialExcelPreview, parseMaterialExcelBatch, parseMaterialExcelFile, parseMaterialExcelWorkbook } from './material-excel-import'
import { appendProductionConstructionScopeBinding } from './production-construction-scope-command'
import { readProductionConstructionMainOptions, readProductionConstructionScopeLink, readProductionConstructionScopeMainFact } from './production-construction-scope-record'
import { loadProductionMaterialContractState as load } from './production-material-contract-record'
import { createReadMeta, readQueryScope, withOriginReadMeta, withReadMeta } from './read-meta'

type Session = () => BusinessSession
function fail(code: 'forbidden' | 'validation-failed' | 'conflict' | 'unavailable', message: string): never {
  throw new MaterialContractRepositoryProblem(materialContractProblem(code, message))
}
function scopedKey(key: string, actor: BusinessSession): string {
  const parts: unknown = JSON.parse(key)
  if (!Array.isArray(parts) || parts.length !== 4 || parts[0] !== actor.workspaceId || parts[1] !== actor.actorId || parts[2] !== 'material-contract' || typeof parts[3] !== 'string' || !parts[3])
    return fail('unavailable', '材采持久命令作用域与正式身份不一致。')
  return parts[3]
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

async function save(tx: TransactionDb, before: MaterialContractOwnerSnapshot, after: MaterialContractOwnerSnapshot, actor: BusinessSession, deferredCommandIds: readonly string[] = []) {
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
    const published = result && deferredCommandIds.includes(result.commandId) ? null : result
    await tx.execute(`INSERT INTO material_contract_commands VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(scoped_id) DO UPDATE SET result_json=excluded.result_json,contract_id=excluded.contract_id`, [key, scopedKey(key, actor), actor.workspaceId, actor.actorId, fingerprintByKey.get(key), JSON.stringify(request), published ? JSON.stringify(published) : null, published?.id ?? null])
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
  async function run<T>(session: Session, write: boolean, operation: (service: ReturnType<typeof createMaterialContractCommandTestInstance>, actor: BusinessSession, tx: TransactionDb, before: MaterialContractOwnerSnapshot) => T | Promise<T>, afterPersist?: (tx: TransactionDb, actor: BusinessSession, result: T, before: MaterialContractOwnerSnapshot) => Promise<void>, deferredCommandIds: readonly string[] = [], atomic = false): Promise<T> {
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
      }, numberConflict: (number, id) => contractNumberConflict(tx, 'material-contracts', id, number), validateDependencies: async (request, candidate, existing) => {
        if (!existing && !request.constructionMain)
          fail('validation-failed', '新建材料采购合同必须搜索并选择实际工程对应的施工主合同。')
        if (request.constructionMain && request.constructionMain.projectId !== candidate.projectId)
          fail('validation-failed', '所选工程与合同项目不一致，不能按同名或首份合同替代。')
        const sourceId = candidate.isSupplement ? candidate.originalContractId : existing?.id
        const prior = sourceId ? await readProductionConstructionScopeLink(tx, { domain: 'material-contract', id: sourceId }) : null
        if (request.constructionMain && prior?.mainId !== request.constructionMain.id) {
          try {
            const main = await readProductionConstructionScopeMainFact(tx, actor, request.constructionMain.id)
            if (!main.eligible || main.projectId !== candidate.projectId || main.basis !== request.constructionMain.basis)
              fail('conflict', '所选施工主合同的有效状态或项目依据已变化，请重新读取工程候选。')
          }
          catch (cause) {
            if (cause instanceof FinanceRepositoryProblem)
              throw new MaterialContractRepositoryProblem(cause.problem)
            throw cause
          }
        }
        if (sourceId) {
          const history = await tx.select<{ project_id: string }>('SELECT project_id FROM construction_scope_history WHERE source_domain=? AND source_id=? AND main_id IS NOT NULL', ['material-contract', sourceId])
          if (history.some(row => row.project_id !== candidate.projectId))
            fail('validation-failed', '合同已有施工归属历史，不能通过普通编辑跨项目移动并破坏原关联。')
        }
      } })
      try {
        service.importState(before)
      }
      catch { return fail('unavailable', '材采持久历史、原命令或归属结构损坏，停止读取。') }
      let result: T | undefined
      let rejected: MaterialContractRepositoryProblem | undefined
      try {
        result = await operation(service, actor, tx, before)
      }
      catch (cause) {
        // 业务拒绝仍固定原规范请求；数据库故障、撤权和未知失败继续撤回整个事务。
        if (atomic || !write || !(cause instanceof MaterialContractRepositoryProblem) || !['validation-failed', 'conflict', 'not-found'].includes(cause.problem.code))
          throw cause
        rejected = cause
      }
      const after = service.exportState()
      const deferred = after.commands.filter(([, receipt]) => deferredCommandIds.includes(receipt.commandId) && !before.commands.some(([, prior]) => prior.commandId === receipt.commandId))
      if (!isDeepStrictEqual(before, after)) {
        if (!write)
          fail('unavailable', '材采只读投影改变持久事实，停止操作。')
        storage.assertBusinessWrite()
        await save(tx, before, after, actor, deferred.map(([, receipt]) => receipt.commandId))
      }
      if (!rejected && result !== undefined && afterPersist)
        await afterPersist(tx, actor, result, before)
      for (const [key, receipt] of deferred)
        await tx.execute('UPDATE material_contract_commands SET result_json=?,contract_id=? WHERE scoped_id=? AND result_json IS NULL', [JSON.stringify(receipt), receipt.id, key])
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
  async function excelPreview(tx: TransactionDb, actor: BusinessSession, before: MaterialContractOwnerSnapshot, groups: Awaited<ReturnType<typeof parseMaterialExcelWorkbook>>) {
    const projects = await tx.select<{ id: string, name: string, version: number }>('SELECT id,name,version FROM projects WHERE deleted_at IS NULL')
    const suppliers = await tx.select<{ id: string, draft_json: string, version: number }>('SELECT id,draft_json,version FROM suppliers')
    return materialExcelPreview(groups, { contracts: before.contracts, projects: projects.map(row => ({ id: row.id, name: row.name, version: String(row.version) })), suppliers: suppliers.map(row => ({ id: row.id, name: String(JSON.parse(row.draft_json).name ?? ''), version: String(row.version) })), mains: await readProductionConstructionMainOptions(tx, actor), signatories: (await readOurSignatories(tx)).records }, actor)
  }
  return {
    async previewExcel(raw: unknown, session: Session) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).join(',') !== 'file')
        fail('validation-failed', '采购合同预览请求无效')
      const file = parseMaterialExcelFile((raw as { file: unknown }).file)
      const groups = await parseMaterialExcelWorkbook(file)
      return run(session, false, async (_service, actor, tx, before) => ({ workspaceId: actor.workspaceId, actorId: actor.actorId, capabilities: [...actor.capabilities], rows: await excelPreview(tx, actor, before, groups), fileHash: materialOriginalDigest(materialOriginalBytes(file, true)!) }))
    },
    async importExcel(raw: unknown, session: Session) {
      const batch = parseMaterialExcelBatch(raw)
      const groups = await parseMaterialExcelWorkbook(batch.file)
      if (groups.length !== batch.decisions.length || groups.some((group, index) => group.key !== batch.decisions[index]?.key))
        fail('validation-failed', '批次确认与工作簿分组不一致')
      const fileHash = materialOriginalDigest(materialOriginalBytes(batch.file, true)!)
      const batchKey = commandFingerprint({ workspaceId: batch.workspaceId, actorId: batch.actorId, fileHash, fileName: batch.file.fileName, fileSize: batch.file.fileSize, decisions: batch.decisions })
      const commandIds = batch.decisions.flatMap((decision, index) => decision.kind === 'skip' ? [] : [`matx-${batchKey}-${index.toString(36)}`])
      if (!commandIds.length)
        fail('validation-failed', '没有选择要导入的合同')
      return run(session, true, async (service, actor, tx, before) => {
        if (actor.workspaceId !== batch.workspaceId || actor.actorId !== batch.actorId)
          fail('forbidden', '导入身份与当前会话不一致')
        if (!['material-contract:read', 'material-contract:write', 'material-contract:sensitive:read', 'project:list:read', 'supplier:list:read', 'construction-contract:read', 'construction-scope:read', 'our-signatory:read'].every(key => actor.capabilities.includes(key)))
          fail('forbidden', '采购合同导入所需来源或权限不完整')
        const prior = commandIds.map(id => before.commands.find(([, result]) => result.commandId === id)?.[1] ?? null)
        if (prior.every(Boolean))
          return { batchKey, results: prior }
        if (prior.some(Boolean))
          fail('unavailable', '批次回执不完整，请停止并核对原编号')
        const rows = await excelPreview(tx, actor, before, groups)
        const targets = new Set<string>()
        const results = []
        for (const [index, decision] of batch.decisions.entries()) {
          const group = groups[index]!
          const preview = rows[index]!
          if (preview.fingerprint !== decision.fingerprint)
            fail('conflict', `第 ${group.rowNumber} 行的合同或关联候选已变化，请重新预览`)
          if (decision.kind === 'skip')
            continue
          if (!decision.project || !preview.projects.some(item => isDeepStrictEqual(item, decision.project)) || !decision.supplier || !preview.suppliers.some(item => isDeepStrictEqual(item, decision.supplier)) || !decision.main || !preview.mains.some(item => item.id === decision.main!.id && item.projectId === decision.main!.projectId && item.basis === decision.main!.basis) || decision.main.projectId !== decision.project.id)
            fail('conflict', `第 ${group.rowNumber} 行请明确选择同项目施工主合同、项目和分供方`)
          if (Boolean(group.signatoryName) !== Boolean(decision.signatory) || (decision.signatory && !preview.signatories.some(item => isDeepStrictEqual(item, decision.signatory))))
            fail('conflict', `第 ${group.rowNumber} 行签约主体选择无效`)
          const selected = decision.kind === 'replace' ? before.contracts.find(row => row.id === decision.id && String(row.version) === decision.version && preview.candidates.some(item => item.id === row.id && item.version === decision.version)) : null
          if (decision.kind === 'replace' && !selected)
            fail('conflict', `第 ${group.rowNumber} 行合同目标或版本已变化`)
          if (selected && group.lineItems.length && (selected.draft.lineItems?.length ?? 0) > 0)
            fail('conflict', `第 ${group.rowNumber} 行已有采购明细，不能批量替换；请在合同页面逐项核对`)
          if (selected && targets.has(selected.id))
            fail('conflict', '同一批次不能重复替换同一合同')
          if (selected)
            targets.add(selected.id)
          const draft = { ...selected?.draft, ...group.draft, projectId: decision.project.id, supplierId: decision.supplier.id, ...(decision.signatory ? { ourSignatoryId: decision.signatory.id, ourSignatoryVersion: decision.signatory.version } : {}), ...(group.lineItems.length ? { lineItems: group.lineItems } : {}) }
          const request = parseMaterialContractCommandRequest({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'material-contract:write', commandId: `matx-${batchKey}-${index.toString(36)}`, ...(selected ? { id: selected.id } : {}), baseVersion: selected ? String(selected.version) : null, action: selected && !['draft', '草稿'].includes(String(selected.draft.status ?? '')) ? 'save' : 'draft', draft, constructionMain: decision.main, attachments: { add: [{ ...batch.file, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', category: 'Excel 导入来源' }] } }, selected ? { kind: 'update', routeId: selected.id } : { kind: 'create' })
          results.push(await service.execute(request, actor))
        }
        return { batchKey, results }
      }, async (tx, actor, result, before) => {
        for (const receipt of result.results) {
          if (!receipt || before.commands.some(([, row]) => row.commandId === receipt.commandId))
            continue
          const index = Number.parseInt(receipt.commandId.slice(receipt.commandId.lastIndexOf('-') + 1), 36)
          const main = batch.decisions[index]!.main!
          const prior = await readProductionConstructionScopeLink(tx, { domain: 'material-contract', id: receipt.id })
          if (prior?.mainId && prior.mainId !== main.id)
            fail('conflict', '已有施工归属不能通过导入更换')
          if (prior?.mainId === main.id)
            continue
          await appendProductionConstructionScopeBinding(tx, actor, { source: { domain: 'material-contract', id: receipt.id }, main, original: { family: 'material-contract', commandId: receipt.commandId } })
        }
      }, commandIds, true)
    },
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
      return run(session, true, (service, actor) => service.execute(request, actor), async (tx, actor, result, before) => {
        if (!request.constructionMain || before.commands.some(([, row]) => row.commandId === request.commandId))
          return
        const sourceId = request.draft.isSupplement ? request.draft.originalContractId : result.id
        if (!sourceId)
          fail('validation-failed', '原协议必须有真实父合同归属。')
        const prior = await readProductionConstructionScopeLink(tx, { domain: 'material-contract', id: sourceId })
        if (prior?.mainId && prior.mainId !== request.constructionMain.id)
          fail('validation-failed', '已关联原合同的施工归属不能随新协议或普通编辑更换，请核对原关联。')
        if (prior?.mainId === request.constructionMain.id)
          return
        try {
          await appendProductionConstructionScopeBinding(tx, actor, { source: { domain: 'material-contract', id: sourceId }, main: request.constructionMain, original: { family: 'material-contract', commandId: request.commandId } })
        }
        catch (cause) {
          if (cause instanceof FinanceRepositoryProblem)
            throw new MaterialContractRepositoryProblem(cause.problem)
          throw cause
        }
      }, [request.commandId])
    },
    resolve(commandId: string, session: Session) {
      return run(session, true, (service, actor) => service.resolve(commandId, actor))
    },
    form(id: string, session: Session) {
      return run(session, false, async (service, actor, tx) => {
        const form = service.form(id, actor)
        if (!actor.capabilities.includes('construction-scope:read'))
          return form
        const target = form.draft.isSupplement ? form.draft.originalContractId : id
        const relation = target ? await readProductionConstructionScopeLink(tx, { domain: 'material-contract', id: target }) : null
        return { ...form, constructionMain: relation?.mainId && relation.mainBasis ? { id: relation.mainId, projectId: relation.projectId, basis: relation.mainBasis } : null }
      })
    },
    context(session: Session) {
      return run(session, false, async (service, actor, tx) => {
        if (!actor.capabilities.includes('material-contract:write'))
          fail('forbidden', '无材料采购合同表单操作权限。')
        const context = service.formContext()
        const originalContracts = []
        for (const row of context.originalContracts) {
          const relation = actor.capabilities.includes('construction-scope:read') ? await readProductionConstructionScopeLink(tx, { domain: 'material-contract', id: row.id }) : null
          originalContracts.push({ ...row, constructionMain: relation?.mainId && relation.mainBasis ? { id: relation.mainId, projectId: relation.projectId, basis: relation.mainBasis } : null })
        }
        return { workspaceId: actor.workspaceId, actorId: actor.actorId, capabilities: [...actor.capabilities], projects: context.projects.map(row => ({ id: row.id, label: row.name })), suppliers: context.suppliers.map(row => ({ id: row.id, label: row.name })), originalContracts, ourSignatories: actor.capabilities.includes('our-signatory:read') ? (await readOurSignatories(tx)).records : [], constructionMains: actor.capabilities.includes('construction-contract:read') && actor.capabilities.includes('project:list:read') ? await readProductionConstructionMainOptions(tx, actor) : [] }
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
