import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { FormAttachmentChanges, ProjectFormDraft } from '../../app/lib/master-data/forms'
import type { ProjectCommandResultDTO, ProjectFormReadDTO } from '../../app/lib/project/command-contract'
import type { ProjectCommandLookup, ProjectLifecycleCommand } from '../../app/lib/project/production-contract'
import type { ProjectDetailReadDTO } from '../../app/lib/project/read-contract'
import type { SourceEvidenceDTO } from '../../app/types/read-model'
import type { BusinessSession } from './business-session'
import type { ProjectRow } from './production-project-record'
import type { ProductionStorage } from './production-storage'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { buildOwnerCommercialDocumentListPage, parseOwnerCommercialDocumentListQuery } from '../../app/lib/owner-document/central-repository'
import { decodeProjectImportSource } from '../../app/lib/project/import'
import { PROJECT_BUSINESS_DOCUMENT_VIEWS } from '../../app/lib/project/read-contract'
import { buildProjectDetailRead, buildProjectListPage, parseProjectDetailQuery, parseProjectListQuery } from '../../app/lib/project/repository'
import { readProductionConstructionDirectoryProjection } from './production-construction-contract-sources'
import { readMaterialContractProjectFacts } from './production-material-contract-service'
import { readProductionOwnerDocumentFacts } from './production-owner-document-service'
import { projectFailure as fail, normalizedProject, projectAttachment, projectDraft, projectListRow } from './production-project-record'
import { parseProductionProjectRequest, productionProjectCommandId, productionProjectId } from './production-project-request'
import { assertProjectCommandBusinessRules, deriveProjectApprovalStatus } from './project-command-domain'
import { createReadMeta, readQueryScope, withOriginReadMeta, withReadMeta } from './read-meta'

type ProductionSession = () => BusinessSession
export const PROJECT_ORIGINAL_MAX_BYTES = 10 * 1024 * 1024
function canonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

function receiptResult(value: string, commandId: string, projectId: string): ProjectCommandResultDTO {
  try {
    const result = JSON.parse(value) as ProjectCommandResultDTO
    if (result.commandId !== commandId || result.id !== projectId || !/^[1-9]\d*$/.test(result.version) || !Number.isSafeInteger(Number(result.version)) || !Number.isFinite(Date.parse(result.updatedAt)) || !Array.isArray(result.attachmentIds) || !result.attachmentIds.every(id => typeof id === 'string'))
      throw new Error('invalid receipt')
    return result
  }
  catch { return fail('unavailable', '原项目提交回执损坏，不能重新建立记录。') }
}
interface ReceiptRow { project_id: string, fingerprint: string, actor_id: string, workspace_id: string, result_json: string }
interface ImportReceiptRow { project_id: string, command_id: string, draft_fingerprint: string, source_json: string }
async function previousResult(tx: TransactionDb, commandId: string, fingerprint: string, actor: BusinessSession) {
  if ((await tx.select('SELECT command_id FROM project_command_resolutions WHERE command_id=?', [commandId])).length)
    fail('conflict', '原提交已核对为未保存并封存，迟到请求不会重新写入。')
  const prior = (await tx.select<ReceiptRow>('SELECT * FROM project_command_receipts WHERE command_id=?', [commandId]))[0]
  if (!prior)
    return null
  if (prior.fingerprint !== fingerprint || prior.actor_id !== actor.actorId || prior.workspace_id !== actor.workspaceId)
    fail('conflict', '同一项目提交编号不能改用其他内容。')
  return receiptResult(prior.result_json, commandId, prior.project_id)
}

async function stored(tx: TransactionDb, id: string): Promise<ProjectRow> {
  const row = (await tx.select<ProjectRow>('SELECT * FROM projects WHERE id=?', [id]))[0]
  if (!row)
    fail('not-found', '项目不存在，请从项目列表重新进入。')
  projectDraft(row)
  return row
}
async function attachments(tx: TransactionDb, id: string) {
  return (await tx.select<Record<string, unknown>>('SELECT * FROM file_refs WHERE owner_type=\'project\' AND owner_id=? ORDER BY uploaded_at,id', [id])).map(projectAttachment)
}

async function assertCustomers(tx: TransactionDb, draft: ProjectFormDraft, actor: BusinessSession) {
  const ids = [...new Set([draft.customerId, draft.secondaryCustomerId].filter((id): id is string => !!id))]
  if (ids.length && !actor.capabilities.includes('customer:list:read'))
    fail('forbidden', '没有读取客户的权限，不能保存项目客户关系。')
  for (const id of ids) {
    const row = (await tx.select<{ status: string, deleted_at: string | null }>('SELECT status,deleted_at FROM customers WHERE id=?', [id]))[0]
    if (!row || row.deleted_at || row.status === 'inactive')
      fail('relationship-mismatch', '项目客户或次客户已失效、停用或删除，请保留输入并重新核对。')
  }
}
async function names(tx: TransactionDb, actor: BusinessSession) {
  return new Map(actor.capabilities.includes('customer:list:read')
    ? (await tx.select<{ id: string, name: string }>('SELECT id,name FROM customers WHERE deleted_at IS NULL')).map(row => [row.id, row.name])
    : [])
}

async function projectBusinessDocuments(tx: TransactionDb, actor: BusinessSession, projectId: string, asOf: string) {
  const pages: NonNullable<ProjectDetailReadDTO['ownerJourneys']>['pages'] = {}
  const issues: string[] = []
  const available = actor.capabilities.includes('owner-document:read') || actor.capabilities.includes('subcontract-document:read')
  const failure = (state: 'forbidden' | 'unavailable') => ({ journeys: { pages, issues }, sources: [{ key: 'owner-documents', state, sourceVersion: null, asOf: null }] satisfies SourceEvidenceDTO[] })
  if (!available) {
    issues.push('当前身份无项目商务单据读取权限')
    return failure('forbidden')
  }
  try {
    const actual = await readProductionOwnerDocumentFacts(tx, actor, { projectId })
    for (const key of Object.keys(PROJECT_BUSINESS_DOCUMENT_VIEWS) as Array<keyof typeof PROJECT_BUSINESS_DOCUMENT_VIEWS>) {
      const [kind, variant] = PROJECT_BUSINESS_DOCUMENT_VIEWS[key]
      const capability = kind.startsWith('sub_') || kind === 'project_penalty' ? 'subcontract-document:read' : 'owner-document:read'
      if (!actor.capabilities.includes(capability)) {
        issues.push(`${key}：无读取权限`)
        continue
      }
      const query = parseOwnerCommercialDocumentListQuery(kind, { projectId, origin: 'real', page: 1, pageSize: 10, ...(variant ? { variant } : {}) })
      const meta = createReadMeta({ session: actor, schemaVersion: 'owner-document-read-v3', operation: 'owner-document:list', dataOrigin: 'real', asOf, sources: actual.sourceEvidence.map(source => ({ ...source, asOf: source.state === 'readable' ? asOf : null })), coverage: 'complete', scope: query })
      const demo = createReadMeta({ session: actor, schemaVersion: 'owner-document-read-v3', operation: 'owner-document:list', dataOrigin: 'demo', asOf, sources: [], coverage: 'unknown', scope: query })
      pages[key] = withOriginReadMeta(buildOwnerCommercialDocumentListPage({ documents: actual.documents, query, asOf, sourceVersion: meta.sourceVersion, capabilities: [...actor.capabilities] }), { real: meta, demo })
    }
    return { journeys: { pages, issues }, sources: [{ key: 'owner-documents', state: 'readable' as const, sourceVersion: actual.sourceVersion, asOf }, ...actual.sourceEvidence.filter(source => source.key !== 'owner-documents').map(source => ({ ...source, key: `business-${source.key}` }))] }
  }
  catch (cause) {
    issues.push(cause instanceof Error ? cause.message : '项目商务单据来源暂不可用')
    return failure('unavailable')
  }
}
async function applyOriginals(tx: TransactionDb, id: string, changes: FormAttachmentChanges, actor: string, now: string) {
  const current = await attachments(tx, id)
  const removed = new Set(changes.removeIds ?? [])
  const restored = new Set(changes.restoreIds ?? [])
  if ([...removed, ...restored].some(fileId => !current.some(file => file.id === fileId)) || [...removed].some(fileId => restored.has(fileId)))
    fail('relationship-mismatch', '附件删除或恢复必须属于当前项目，且不能同时进行。')
  for (const fileId of removed) await tx.execute('UPDATE file_refs SET deleted_at=? WHERE id=?', [now, fileId])
  for (const fileId of restored) await tx.execute('UPDATE file_refs SET deleted_at=NULL WHERE id=?', [fileId])
  for (const file of changes.add ?? []) {
    if (!text(file.fileName) || text(file.fileName).length > 240 || !Number.isSafeInteger(file.fileSize) || file.fileSize! < 0 || file.fileSize! > PROJECT_ORIGINAL_MAX_BYTES
      || typeof file.contentBase64 !== 'string' || file.contentBase64.length > Math.ceil(PROJECT_ORIGINAL_MAX_BYTES / 3) * 4) {
      fail('validation-failed', '项目原件需提供真实正文，单份不超过 10 MiB，不能只保存文件路径。')
    }
    const bytes = Buffer.from(file.contentBase64!, 'base64')
    if (bytes.toString('base64') !== file.contentBase64 || bytes.length !== file.fileSize)
      fail('validation-failed', '原件正文、大小或编码不一致。')
    const fileId = randomUUID()
    await tx.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,category,uploader,uploaded_at) VALUES(?,\'project\',?,?,?,?,?,?,?)', [fileId, id, text(file.fileName), bytes.length, text(file.mimeType) || 'application/octet-stream', text(file.category), actor, now])
    await tx.execute('INSERT INTO file_payloads(file_ref_id,content,sha256) VALUES(?,?,?)', [fileId, bytes, digest(bytes)])
  }
}

export function createProductionProjectService(storage: ProductionStorage) {
  function authorize(resolveSession: ProductionSession, write = false) {
    const session = resolveSession()
    if (session.workspaceId !== storage.identity.workspaceId || session.actorId !== storage.identity.actorId
      || !session.capabilities.includes('project:list:read') || (write && !session.capabilities.includes('project:write'))) {
      fail('forbidden', '当前会话没有此工作区的项目权限。')
    }
    return session
  }
  async function run<T>(session: ProductionSession, write: boolean, work: (tx: TransactionDb, actor: BusinessSession) => Promise<T>): Promise<T> {
    const actor = authorize(session, write)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      const result = await work(tx, actor)
      const after = authorize(session, write)
      if (canonical(after) !== canonical(actor))
        fail('forbidden', '操作期间会话或权限已变化，本次提交已撤回。')
      return result
    })
  }
  return {
    async execute(value: unknown, session: ProductionSession, routeId?: string | null): Promise<ProjectCommandResultDTO> {
      const request = parseProductionProjectRequest(value, routeId)
      return run(session, true, async (tx, actor) => {
        if (request.workspaceId !== actor.workspaceId || request.actorId !== actor.actorId || !text(request.commandId))
          fail('forbidden', '项目命令身份与当前可信会话不一致。')
        const fingerprint = digest(canonical(request))
        const prior = await previousResult(tx, request.commandId, fingerprint, actor)
        if (prior)
          return prior
        const draft = normalizedProject(request.draft)
        assertProjectCommandBusinessRules(draft, request.action)
        await assertCustomers(tx, draft, actor)
        const importSource = request.importSource
        const draftFingerprint = digest(canonical(draft))
        if (importSource) {
          const existing = await tx.select<ImportReceiptRow>('SELECT * FROM project_import_receipts WHERE (file_digest=? AND sheet_name=? AND row_number=?) OR (?<>\'\' AND external_ref=?)', [importSource.fileDigest, importSource.sheetName, importSource.rowNumber, importSource.externalRef, importSource.externalRef])
          if (existing.length > 1)
            fail('conflict', '该来源行与外部旧 ID 指向不同项目，请人工核对。')
          const match = existing[0]
          if (match) {
            if (match.draft_fingerprint !== draftFingerprint)
              fail('conflict', '该 Excel 来源或外部旧 ID 已保存不同内容，请进入原项目显式编辑。')
            const original = (await tx.select<ReceiptRow>('SELECT * FROM project_command_receipts WHERE command_id=?', [match.command_id]))[0]
            if (!original || original.project_id !== match.project_id)
              fail('unavailable', '项目 Excel 原导入回执缺失，请核对备份。')
            const result = receiptResult(original.result_json, match.command_id, match.project_id)
            // The new command is also remembered, while the importer receives the original result.
            await tx.execute('INSERT INTO project_command_receipts VALUES(?,?,?,?,?,?,?,?)', [request.commandId, actor.workspaceId, actor.actorId, match.project_id, fingerprint, 'import-replay', JSON.stringify({ ...result, commandId: request.commandId }), new Date().toISOString()])
            return { ...result, commandId: request.commandId }
          }
        }
        const previous = request.id ? await stored(tx, request.id) : null
        const beforeFiles = previous ? await attachments(tx, previous.id) : []
        if (previous?.deleted_at)
          fail('conflict', '项目已删除，请先恢复再编辑。')
        if ((previous && request.baseVersion !== String(previous.version)) || (!previous && request.baseVersion !== null))
          fail('conflict', '项目版本已变化，请保留输入并核对最新版本。')
        draft.approvalStatus = deriveProjectApprovalStatus(request.action, previous ? projectDraft(previous).approvalStatus : null)
        const id = previous?.id ?? randomUUID()
        const now = new Date().toISOString()
        const version = (previous?.version ?? 0) + 1
        if (!Number.isSafeInteger(version))
          fail('unavailable', '项目版本超过安全范围，请停止写入并核对数据。')
        const values = [draft.name ?? '', draft.code ?? '', draft.customerId || null, draft.secondaryCustomerId || null, JSON.stringify(draft), version, now]
        if (previous)
          await tx.execute('UPDATE projects SET name=?,code=?,customer_id=?,secondary_customer_id=?,draft_json=?,version=?,updated_at=? WHERE id=?', [...values, id])
        else
          await tx.execute('INSERT INTO projects(id,name,code,customer_id,secondary_customer_id,draft_json,version,updated_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)', [id, ...values, now])
        await applyOriginals(tx, id, request.attachments, actor.actorId, now)
        await tx.execute('UPDATE project_revision SET revision=revision+1 WHERE singleton=1')
        const result = { id, commandId: request.commandId, version: String(version), updatedAt: now, attachmentIds: (await attachments(tx, id)).filter(file => !file.deletedAt).map(file => file.id) }
        await tx.execute('INSERT INTO project_command_receipts VALUES(?,?,?,?,?,?,?,?)', [request.commandId, actor.workspaceId, actor.actorId, id, fingerprint, previous ? 'update' : 'create', JSON.stringify(result), now])
        if (importSource)
          await tx.execute('INSERT INTO project_import_receipts VALUES(?,?,?,?,?,?,?,?)', [id, request.commandId, importSource.fileDigest, importSource.sheetName, importSource.rowNumber, importSource.externalRef, JSON.stringify(importSource), draftFingerprint])
        await tx.execute('INSERT INTO project_audits VALUES(?,?,?,?,?,?,?,?)', [randomUUID(), id, request.commandId, actor.actorId, previous ? 'update' : 'create', previous ? JSON.stringify({ draft: projectDraft(previous), attachments: beforeFiles }) : null, JSON.stringify({ draft: { ...draft, id }, attachments: await attachments(tx, id) }), now])
        return result
      })
    },
    executeLifecycle(request: ProjectLifecycleCommand, session: ProductionSession): Promise<ProjectCommandResultDTO> {
      if (!request || Object.keys(request).sort().join(',') !== ['id', 'commandId', 'workspaceId', 'actorId', 'requiredCapability', 'baseVersion', 'action'].sort().join(',')
        || !['delete', 'restore'].includes(request.action) || !productionProjectId(request.id) || !productionProjectId(request.commandId) || typeof request.baseVersion !== 'string' || request.requiredCapability !== 'project:write') {
        fail('validation-failed', '项目删除或恢复命令不完整。')
      }
      return run(session, true, async (tx, actor) => {
        if (request.workspaceId !== actor.workspaceId || request.actorId !== actor.actorId)
          fail('forbidden', '项目命令身份与当前可信会话不一致。')
        const fingerprint = digest(canonical(request))
        const prior = await previousResult(tx, request.commandId, fingerprint, actor)
        if (prior)
          return prior
        const previous = await stored(tx, request.id)
        if (request.baseVersion !== String(previous.version) || (request.action === 'delete' ? !!previous.deleted_at : !previous.deleted_at))
          fail('conflict', '项目状态或版本已变化，请重新核对。')
        const now = new Date().toISOString()
        const deletedAt = request.action === 'delete' ? now : null
        const version = previous.version + 1
        if (!Number.isSafeInteger(version))
          fail('unavailable', '项目版本超过安全范围，请停止写入并核对数据。')
        await tx.execute('UPDATE projects SET deleted_at=?,version=?,updated_at=? WHERE id=?', [deletedAt, version, now, request.id])
        await tx.execute('UPDATE project_revision SET revision=revision+1 WHERE singleton=1')
        const result = { id: request.id, commandId: request.commandId, version: String(version), updatedAt: now, attachmentIds: (await attachments(tx, request.id)).filter(file => !file.deletedAt).map(file => file.id) }
        await tx.execute('INSERT INTO project_command_receipts VALUES(?,?,?,?,?,?,?,?)', [request.commandId, actor.workspaceId, actor.actorId, request.id, fingerprint, request.action, JSON.stringify(result), now])
        await tx.execute('INSERT INTO project_audits VALUES(?,?,?,?,?,?,?,?)', [randomUUID(), request.id, request.commandId, actor.actorId, request.action, JSON.stringify({ deletedAt: previous.deleted_at }), JSON.stringify({ deletedAt }), now])
        return result
      })
    },
    lifecycle(id: string, session: ProductionSession) {
      return run(session, false, async (tx) => {
        const row = await stored(tx, id)
        return { id, name: projectDraft(row).name!, version: String(row.version), deletedAt: row.deleted_at }
      })
    },
    deleted(session: ProductionSession) {
      return run(session, false, async tx => (await tx.select<ProjectRow>('SELECT * FROM projects WHERE deleted_at IS NOT NULL ORDER BY updated_at DESC')).map(row => ({ id: row.id, name: projectDraft(row).name!, version: String(row.version), deletedAt: row.deleted_at })))
    },
    command(commandId: string, session: ProductionSession): Promise<ProjectCommandLookup> {
      return run(session, false, async (tx, actor) => {
        const row = (await tx.select<ReceiptRow>('SELECT * FROM project_command_receipts WHERE command_id=?', [commandId]))[0]
        if (!row)
          return { commandId, outcome: 'not-applied', result: null, fingerprint: null }
        if (row.actor_id !== actor.actorId || row.workspace_id !== actor.workspaceId)
          fail('forbidden', '原提交不属于当前工作区或操作者。')
        return { commandId, outcome: 'applied', result: receiptResult(row.result_json, commandId, row.project_id), fingerprint: row.fingerprint }
      })
    },
    resolveCommand(commandId: string, session: ProductionSession): Promise<ProjectCommandLookup> {
      if (!productionProjectCommandId(commandId))
        fail('validation-failed', '原提交编号无效。')
      return run(session, true, async (tx, actor) => {
        const row = (await tx.select<ReceiptRow>('SELECT * FROM project_command_receipts WHERE command_id=?', [commandId]))[0]
        if (row) {
          if (row.actor_id !== actor.actorId || row.workspace_id !== actor.workspaceId)
            fail('forbidden', '原提交不属于当前工作区或操作者。')
          return { commandId, outcome: 'applied', result: receiptResult(row.result_json, commandId, row.project_id), fingerprint: row.fingerprint }
        }
        await tx.execute('INSERT OR IGNORE INTO project_command_resolutions VALUES(?,?,?,?)', [commandId, actor.workspaceId, actor.actorId, new Date().toISOString()])
        return { commandId, outcome: 'not-applied', result: null, fingerprint: null }
      })
    },
    form(id: string, session: ProductionSession): Promise<ProjectFormReadDTO> {
      authorize(session, true)
      return run(session, false, async (tx) => {
        const row = await stored(tx, id)
        if (row.deleted_at)
          fail('conflict', '项目已删除，请先恢复后再编辑。')
        const imported = (await tx.select<ImportReceiptRow>('SELECT * FROM project_import_receipts WHERE project_id=?', [id]))[0]
        let importSource
        try {
          importSource = imported ? decodeProjectImportSource(JSON.parse(imported.source_json)) : undefined
        }
        catch { fail('unavailable', '项目导入追溯信息损坏，请核对备份。') }
        authorize(session, true)
        return { draft: projectDraft(row), attachments: await attachments(tx, id), version: String(row.version), updatedAt: row.updated_at, ...(importSource ? { importSource } : {}) }
      })
    },
    list(input: Record<string, unknown>, session: ProductionSession) {
      return run(session, false, async (tx, actor) => {
        const query = parseProjectListQuery(input)
        if (query.includeDemo)
          fail('forbidden', '正式磁盘项目不混入测试来源。')
        const rows = await tx.select<ProjectRow>('SELECT * FROM projects WHERE deleted_at IS NULL')
        const [revision] = await tx.select<{ revision: number }>('SELECT revision FROM project_revision')
        const customers = await names(tx, actor)
        const asOf = new Date().toISOString()
        const customerRevision = actor.capabilities.includes('customer:list:read') ? (await tx.select<{ revision: number }>('SELECT revision FROM customer_revision'))[0]!.revision : null
        const common = { session: actor, schemaVersion: 'project-read-v2', operation: 'project:list', asOf, scope: readQueryScope(query) }
        const real = createReadMeta({ ...common, dataOrigin: 'real', coverage: 'complete', sources: [
          { key: 'projects', state: 'readable', sourceVersion: `projects:${revision!.revision}`, asOf },
          customerRevision === null ? { key: 'customers', state: 'forbidden', sourceVersion: null, asOf: null } : { key: 'customers', state: 'readable', sourceVersion: `customers:${customerRevision}`, asOf },
          { key: 'receipts', state: 'not-requested', sourceVersion: null, asOf: null },
          { key: 'target-costs', state: 'not-requested', sourceVersion: null, asOf: null },
        ] })
        const demo = createReadMeta({ ...common, dataOrigin: 'demo', coverage: 'unknown', sources: [{ key: 'projects', state: 'not-requested', sourceVersion: null, asOf: null }] })
        return withOriginReadMeta(buildProjectListPage({ rows: rows.map(row => projectListRow(row, customers, actor.capabilities.includes('customer:list:read'))), query, asOf, sourceVersion: real.sourceVersion, capabilities: real.capabilities }), { real, demo })
      })
    },
    detail(id: string, input: Record<string, unknown>, session: ProductionSession) {
      return run(session, false, async (tx, actor) => {
        const query = parseProjectDetailQuery(id, input)
        if (query.origin !== 'real' || query.includeDemo)
          fail('forbidden', '正式磁盘项目不接受测试来源。')
        const row = await stored(tx, id)
        const customerRevision = actor.capabilities.includes('customer:list:read') ? (await tx.select<{ revision: number }>('SELECT revision FROM customer_revision'))[0]!.revision : null
        const asOf = new Date().toISOString()
        const materialFacts = await readMaterialContractProjectFacts(tx, actor, id, asOf)
        const construction = await readProductionConstructionDirectoryProjection(tx, actor, asOf, id)
        const commercial = await projectBusinessDocuments(tx, actor, id, asOf)
        const meta = createReadMeta({ session: actor, schemaVersion: 'project-read-v2', operation: 'project:detail', dataOrigin: 'real', asOf, coverage: 'complete', scope: query, sources: [
          { key: 'projects', state: 'readable', sourceVersion: `project:${row.version}`, asOf },
          customerRevision === null ? { key: 'customers', state: 'forbidden', sourceVersion: null, asOf: null } : { key: 'customers', state: 'readable', sourceVersion: `customers:${customerRevision}`, asOf },
          materialFacts.source,
          construction.source,
          { ...construction.source, key: 'construction-management-fee-configurations' },
          { key: 'project-suppliers', state: 'unavailable', sourceVersion: null, asOf: null },
          { key: 'receipts', state: 'not-requested', sourceVersion: null, asOf: null },
          { key: 'target-costs', state: 'not-requested', sourceVersion: null, asOf: null },
          ...commercial.sources,
        ] })
        return withReadMeta({ ...buildProjectDetailRead({ rows: [projectListRow(row, await names(tx, actor), actor.capabilities.includes('customer:list:read'))], query, materialContractCount: materialFacts.count, materialContractAccess: materialFacts.source.state === 'readable' ? 'allowed' : materialFacts.source.state === 'forbidden' ? 'forbidden' : 'unknown', projectSupplierAccess: 'error', asOf, sourceVersion: meta.sourceVersion, capabilities: meta.capabilities }), ownerJourneys: commercial.journeys, ...(construction.configuration ? { constructionManagementFees: construction.configuration } : {}) }, meta)
      })
    },
    file(projectId: string, fileId: string, session: ProductionSession) {
      return run(session, false, async (tx) => {
        const owner = await stored(tx, projectId)
        const row = (await tx.select<Record<string, unknown>>('SELECT f.*,p.content,p.sha256 FROM file_refs f JOIN file_payloads p ON p.file_ref_id=f.id WHERE f.id=? AND f.owner_type=\'project\' AND f.owner_id=? AND f.deleted_at IS NULL', [fileId, projectId]))[0]
        if (owner.deleted_at || !row)
          fail('not-found', '原件不存在或已删除，请从所属项目重新进入。')
        const bytes = row.content
        if (!(bytes instanceof Uint8Array) || bytes.length !== row.file_size || digest(bytes) !== row.sha256)
          fail('unavailable', '原件摘要或正文不一致，停止下载并核对备份。')
        return { ...projectAttachment(row), bytes, sha256: String(row.sha256) }
      })
    },
    audit(projectId: string, session: ProductionSession) {
      return run(session, false, async (tx) => {
        await stored(tx, projectId)
        const rows = await tx.select<{ id: string, actor_id: string, action: string, command_id: string, created_at: string }>('SELECT id,actor_id,action,command_id,created_at FROM project_audits WHERE project_id=? ORDER BY created_at,id', [projectId])
        return rows.map(row => ({ id: row.id, actorId: row.actor_id, action: row.action, commandId: row.command_id, createdAt: row.created_at }))
      })
    },
  }
}
