import type { CustomerCommandResultDTO, CustomerFormReadDTO } from '../../app/lib/customer/command-contract'
import type { CustomerCommandLookup, CustomerLifecycleCommand } from '../../app/lib/customer/production-contract'
import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { FormAttachmentChanges } from '../../app/lib/master-data/forms'
import type { BusinessSession } from './business-session'
import type { CustomerRow } from './production-customer-record'
import type { ProductionStorage } from './production-storage'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { buildCustomerDetailRead, buildCustomerListPage, customerProblem, parseCustomerDetailQuery, parseCustomerListQuery } from '../../app/lib/customer/repository'
import { readProductionConstructionDirectoryProjection } from './production-construction-contract-sources'
import { CUSTOMER_FIELDS, customerAttachment, customerDraft, customerListRow, customerFailure as fail, normalizedCustomer } from './production-customer-record'
import { parseProductionCustomerRequest, productionCustomerId } from './production-customer-request'
import { productionCustomerProjects } from './production-project-relations'
import { createReadMeta, readQueryScope, withOriginReadMeta, withReadMeta } from './read-meta'

export type ProductionSession = () => BusinessSession
export const CUSTOMER_ORIGINAL_MAX_BYTES = 10 * 1024 * 1024
function canonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

function receiptResult(value: string, commandId: string, customerId: string): CustomerCommandResultDTO {
  try {
    const result = JSON.parse(value) as CustomerCommandResultDTO
    if (result.commandId !== commandId || result.id !== customerId || !/^[1-9]\d*$/.test(result.version) || !Number.isSafeInteger(Number(result.version)) || !Number.isFinite(Date.parse(result.updatedAt)) || !Array.isArray(result.attachmentIds) || !result.attachmentIds.every(id => typeof id === 'string'))
      throw new Error('invalid receipt')
    return result
  }
  catch { return fail('unavailable', '原客户提交回执损坏，不能重新建立记录。') }
}
interface ReceiptRow { customer_id: string, fingerprint: string, actor_id: string, workspace_id: string, result_json: string }
async function previousResult(tx: TransactionDb, commandId: string, fingerprint: string, actor: BusinessSession) {
  if ((await tx.select('SELECT command_id FROM customer_command_resolutions WHERE command_id=?', [commandId])).length)
    fail('conflict', '原提交已核对为未保存并封存，迟到请求不会重新写入。')
  const prior = (await tx.select<ReceiptRow>('SELECT * FROM customer_command_receipts WHERE command_id=?', [commandId]))[0]
  if (!prior)
    return null
  if (prior.fingerprint !== fingerprint || prior.actor_id !== actor.actorId || prior.workspace_id !== actor.workspaceId)
    fail('conflict', '同一客户提交编号不能改用其他内容。')
  return receiptResult(prior.result_json, commandId, prior.customer_id)
}

async function stored(tx: TransactionDb, id: string): Promise<CustomerRow> {
  const row = (await tx.select<CustomerRow>('SELECT * FROM customers WHERE id=?', [id]))[0]
  if (!row)
    fail('not-found', '客户不存在，请从客户列表重新进入。')
  customerDraft(row)
  return row
}
/** 直接引用客户的有效业务记录；所属参与者尚未安装时跳过。收付款经项目间接关联，项目在用即阻止。 */
const CUSTOMER_REFERENCES = [
  { table: 'projects', label: '项目', unit: '个', where: '(customer_id=? OR secondary_customer_id=?)', params: 2 },
  { table: 'construction_contract_records', label: '施工合同', unit: '份', where: 'customer_id=?', params: 1 },
  { table: 'invoice_applications', label: '开票申请', unit: '张', where: 'customer_id=?', params: 1 },
] as const
async function activeCustomerReferences(tx: TransactionDb, id: string): Promise<string[]> {
  const installed = new Set((await tx.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\'')).map(row => row.name))
  const found: string[] = []
  for (const ref of CUSTOMER_REFERENCES) {
    if (!installed.has(ref.table))
      continue
    const [row] = await tx.select<{ n: number }>(`SELECT COUNT(*) AS n FROM ${ref.table} WHERE deleted_at IS NULL AND ${ref.where}`, Array.from({ length: ref.params }).fill(id))
    if (row && row.n > 0)
      found.push(`${ref.label} ${row.n} ${ref.unit}`)
  }
  return found
}
async function attachments(tx: TransactionDb, id: string) {
  return (await tx.select<Record<string, unknown>>('SELECT * FROM file_refs WHERE owner_type=\'customer\' AND owner_id=? ORDER BY uploaded_at,id', [id])).map(customerAttachment)
}
async function applyOriginals(tx: TransactionDb, id: string, changes: FormAttachmentChanges, actor: string, now: string) {
  const current = await attachments(tx, id)
  const removed = new Set(changes.removeIds ?? [])
  const restored = new Set(changes.restoreIds ?? [])
  if ([...removed, ...restored].some(fileId => !current.some(file => file.id === fileId)) || [...removed].some(fileId => restored.has(fileId)))
    fail('relationship-mismatch', '附件删除或恢复必须属于当前客户，且不能同时进行。')
  const finalCount = current.filter(file => restored.has(file.id) || (!file.deletedAt && !removed.has(file.id))).length + (changes.add?.length ?? 0)
  if (finalCount > 9)
    fail('validation-failed', '客户附件最多 9 份。')
  for (const fileId of removed) await tx.execute('UPDATE file_refs SET deleted_at=? WHERE id=?', [now, fileId])
  for (const fileId of restored) await tx.execute('UPDATE file_refs SET deleted_at=NULL WHERE id=?', [fileId])
  for (const file of changes.add ?? []) {
    if (!text(file.fileName) || text(file.fileName).length > 240 || !Number.isSafeInteger(file.fileSize) || file.fileSize! < 0 || file.fileSize! > CUSTOMER_ORIGINAL_MAX_BYTES
      || typeof file.contentBase64 !== 'string' || file.contentBase64.length > Math.ceil(CUSTOMER_ORIGINAL_MAX_BYTES / 3) * 4) {
      fail('validation-failed', '客户原件需提供真实正文，单份不超过 10 MiB，不能只保存文件路径。')
    }
    const bytes = Buffer.from(file.contentBase64!, 'base64')
    if (bytes.toString('base64') !== file.contentBase64 || bytes.length !== file.fileSize)
      fail('validation-failed', '原件正文、大小或编码不一致。')
    const fileId = randomUUID()
    await tx.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,category,uploader,uploaded_at) VALUES(?,\'customer\',?,?,?,?,?,?,?)', [fileId, id, text(file.fileName), bytes.length, text(file.mimeType) || 'application/octet-stream', text(file.category), actor, now])
    await tx.execute('INSERT INTO file_payloads(file_ref_id,content,sha256) VALUES(?,?,?)', [fileId, bytes, digest(bytes)])
  }
}

export function createProductionCustomerService(storage: ProductionStorage) {
  function authorize(resolveSession: ProductionSession, write = false) {
    const session = resolveSession()
    if (session.workspaceId !== storage.identity.workspaceId || session.actorId !== storage.identity.actorId
      || !session.capabilities.includes('customer:list:read') || (write && !session.capabilities.includes('customer:write'))) {
      fail('forbidden', '当前会话没有此工作区的客户权限。')
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
    async execute(value: unknown, session: ProductionSession, routeId?: string | null): Promise<CustomerCommandResultDTO> {
      const request = parseProductionCustomerRequest(value, routeId)
      return run(session, true, async (tx, actor) => {
        if (request.workspaceId !== actor.workspaceId || request.actorId !== actor.actorId || !text(request.commandId))
          fail('forbidden', '客户命令身份与当前可信会话不一致。')
        const fingerprint = digest(canonical(request))
        const prior = await previousResult(tx, request.commandId, fingerprint, actor)
        if (prior)
          return prior
        const draft = normalizedCustomer(request.draft)
        if (request.action !== 'draft' && (!draft.name || !draft.contact))
          fail('validation-failed', '客户名称和联系人为必填项。')
        const previous = request.id ? await stored(tx, request.id) : null
        if (previous?.deleted_at)
          fail('conflict', '客户已删除，请先恢复再编辑。')
        if ((previous && request.baseVersion !== String(previous.version)) || (!previous && request.baseVersion !== null))
          fail('conflict', '客户版本已变化，请保留输入并核对最新版本。')
        if (draft.taxNo && (await tx.select('SELECT id FROM customers WHERE tax_no=? AND id<>?', [draft.taxNo, request.id ?? ''])).length)
          fail('validation-failed', '统一社会信用代码已存在。')
        const id = previous?.id ?? randomUUID()
        const now = new Date().toISOString()
        const version = (previous?.version ?? 0) + 1
        if (!Number.isSafeInteger(version))
          fail('unavailable', '客户版本超过安全范围，请停止写入并核对数据。')
        const fields = Object.entries(CUSTOMER_FIELDS)
        const values = fields.map(([field]) => draft[field as keyof typeof CUSTOMER_FIELDS] ?? '')
        if (previous)
          await tx.execute(`UPDATE customers SET ${fields.map(([, column]) => `${column}=?`).join(',')},aliases=?,version=?,updated_at=? WHERE id=?`, [...values, JSON.stringify(draft.aliases), version, now, id])
        else
          await tx.execute(`INSERT INTO customers(id,${fields.map(([, column]) => column).join(',')},aliases,version,created_at,updated_at) VALUES(${Array.from({ length: fields.length + 5 }).fill('?').join(',')})`, [id, ...values, JSON.stringify(draft.aliases), version, now, now])
        await applyOriginals(tx, id, request.attachments, actor.actorId, now)
        await tx.execute('UPDATE customer_revision SET revision=revision+1 WHERE singleton=1')
        const result = { id, commandId: request.commandId, version: String(version), updatedAt: now, attachmentIds: (await attachments(tx, id)).filter(file => !file.deletedAt).map(file => file.id) }
        await tx.execute('INSERT INTO customer_command_receipts VALUES(?,?,?,?,?,?,?,?)', [request.commandId, actor.workspaceId, actor.actorId, id, fingerprint, previous ? 'update' : 'create', JSON.stringify(result), now])
        await tx.execute('INSERT INTO customer_audits VALUES(?,?,?,?,?,?,?,?)', [randomUUID(), id, request.commandId, actor.actorId, previous ? 'update' : 'create', previous ? JSON.stringify(customerDraft(previous)) : null, JSON.stringify({ ...draft, id }), now])
        return result
      })
    },
    executeLifecycle(request: CustomerLifecycleCommand, session: ProductionSession): Promise<CustomerCommandResultDTO> {
      if (!request || Object.keys(request).sort().join(',') !== ['id', 'commandId', 'workspaceId', 'actorId', 'requiredCapability', 'baseVersion', 'action'].sort().join(',')
        || !['delete', 'restore'].includes(request.action) || !productionCustomerId(request.id) || !productionCustomerId(request.commandId) || typeof request.baseVersion !== 'string' || request.requiredCapability !== 'customer:write') {
        fail('validation-failed', '客户删除或恢复命令不完整。')
      }
      return run(session, true, async (tx, actor) => {
        if (request.workspaceId !== actor.workspaceId || request.actorId !== actor.actorId)
          fail('forbidden', '客户命令身份与当前可信会话不一致。')
        const fingerprint = digest(canonical(request))
        const prior = await previousResult(tx, request.commandId, fingerprint, actor)
        if (prior)
          return prior
        const previous = await stored(tx, request.id)
        if (request.baseVersion !== String(previous.version) || (request.action === 'delete' ? !!previous.deleted_at : !previous.deleted_at))
          fail('conflict', '客户状态或版本已变化，请重新核对。')
        if (request.action === 'delete') {
          const references = await activeCustomerReferences(tx, request.id)
          if (references.length)
            fail('conflict', `客户仍被${references.join('、')}引用，不能删除；请先处理这些记录。`)
        }
        const now = new Date().toISOString()
        const deletedAt = request.action === 'delete' ? now : null
        const version = previous.version + 1
        if (!Number.isSafeInteger(version))
          fail('unavailable', '客户版本超过安全范围，请停止写入并核对数据。')
        await tx.execute('UPDATE customers SET deleted_at=?,version=?,updated_at=? WHERE id=?', [deletedAt, version, now, request.id])
        await tx.execute('UPDATE customer_revision SET revision=revision+1 WHERE singleton=1')
        const result = { id: request.id, commandId: request.commandId, version: String(version), updatedAt: now, attachmentIds: (await attachments(tx, request.id)).filter(file => !file.deletedAt).map(file => file.id) }
        await tx.execute('INSERT INTO customer_command_receipts VALUES(?,?,?,?,?,?,?,?)', [request.commandId, actor.workspaceId, actor.actorId, request.id, fingerprint, request.action, JSON.stringify(result), now])
        await tx.execute('INSERT INTO customer_audits VALUES(?,?,?,?,?,?,?,?)', [randomUUID(), request.id, request.commandId, actor.actorId, request.action, JSON.stringify({ deletedAt: previous.deleted_at }), JSON.stringify({ deletedAt }), now])
        return result
      })
    },
    lifecycle(id: string, session: ProductionSession) {
      return run(session, false, async (tx) => {
        const row = await stored(tx, id)
        return { id, name: customerDraft(row).name!, version: String(row.version), deletedAt: row.deleted_at }
      })
    },
    deleted(session: ProductionSession) {
      return run(session, false, async tx => (await tx.select<CustomerRow>('SELECT * FROM customers WHERE deleted_at IS NOT NULL ORDER BY updated_at DESC')).map(row => ({ id: row.id, name: customerDraft(row).name!, version: String(row.version), deletedAt: row.deleted_at })))
    },
    command(commandId: string, session: ProductionSession): Promise<CustomerCommandLookup> {
      return run(session, false, async (tx, actor) => {
        const row = (await tx.select<ReceiptRow>('SELECT * FROM customer_command_receipts WHERE command_id=?', [commandId]))[0]
        if (!row)
          return { commandId, outcome: 'not-applied', result: null, fingerprint: null }
        if (row.actor_id !== actor.actorId || row.workspace_id !== actor.workspaceId)
          fail('forbidden', '原提交不属于当前工作区或操作者。')
        return { commandId, outcome: 'applied', result: receiptResult(row.result_json, commandId, row.customer_id), fingerprint: row.fingerprint }
      })
    },
    resolveCommand(commandId: string, session: ProductionSession): Promise<CustomerCommandLookup> {
      if (!/^[A-Z0-9][\w-]{2,79}$/i.test(commandId))
        fail('validation-failed', '原提交编号无效。')
      return run(session, true, async (tx, actor) => {
        const row = (await tx.select<ReceiptRow>('SELECT * FROM customer_command_receipts WHERE command_id=?', [commandId]))[0]
        if (row) {
          if (row.actor_id !== actor.actorId || row.workspace_id !== actor.workspaceId)
            fail('forbidden', '原提交不属于当前工作区或操作者。')
          return { commandId, outcome: 'applied', result: receiptResult(row.result_json, commandId, row.customer_id), fingerprint: row.fingerprint }
        }
        await tx.execute('INSERT OR IGNORE INTO customer_command_resolutions VALUES(?,?,?,?)', [commandId, actor.workspaceId, actor.actorId, new Date().toISOString()])
        return { commandId, outcome: 'not-applied', result: null, fingerprint: null }
      })
    },
    form(id: string, session: ProductionSession): Promise<CustomerFormReadDTO> {
      authorize(session, true)
      return run(session, false, async (tx) => {
        const row = await stored(tx, id)
        return { draft: customerDraft(row), attachments: await attachments(tx, id), version: String(row.version), updatedAt: row.updated_at }
      })
    },
    list(input: Record<string, unknown>, session: ProductionSession) {
      return run(session, false, async (tx, actor) => {
        const query = parseCustomerListQuery(input)
        if (query.includeDemo)
          fail('forbidden', '正式磁盘客户不混入测试来源。')
        const rows = await tx.select<CustomerRow>('SELECT * FROM customers WHERE deleted_at IS NULL')
        const [revision] = await tx.select<{ revision: number }>('SELECT revision FROM customer_revision')
        const asOf = new Date().toISOString()
        const sourceVersion = `production-customer:${revision!.revision}`
        const common = { session: actor, schemaVersion: 'customer-read-v2', operation: 'customer:list', asOf, scope: readQueryScope(query) }
        const real = createReadMeta({ ...common, dataOrigin: 'real', coverage: 'complete', sources: [{ key: 'customers', state: 'readable', sourceVersion, asOf }] })
        const demo = createReadMeta({ ...common, dataOrigin: 'demo', coverage: 'unknown', sources: [{ key: 'customers', state: 'not-requested', sourceVersion: null, asOf: null }] })
        return withOriginReadMeta(buildCustomerListPage({ rows: rows.map(customerListRow), query, asOf, sourceVersion, capabilities: [...actor.capabilities] }), { real, demo })
      })
    },
    detail(id: string, input: Record<string, unknown>, session: ProductionSession) {
      return run(session, false, async (tx, actor) => {
        const query = parseCustomerDetailQuery(id, input)
        if (query.origin !== 'real' || query.includeDemo)
          fail('forbidden', '正式磁盘客户不接受测试来源。')
        const row = await stored(tx, id)
        const notReady = customerProblem('unavailable', '关联领域尚未接入正式持久化，不能把未读取显示为零。')
        const projects = actor.capabilities.includes('project:list:read') ? await productionCustomerProjects(tx) : null
        const projectsProblem = projects === null ? actor.capabilities.includes('project:list:read') ? notReady : customerProblem('forbidden', '当前会话没有项目读取权限。') : undefined
        const projectRevision = projects === null ? null : (await tx.select<{ revision: number }>('SELECT revision FROM project_revision'))[0]!.revision
        const asOf = new Date().toISOString()
        const construction = await readProductionConstructionDirectoryProjection(tx, actor, asOf)
        const contractsProblem = construction.contracts === null ? construction.source.state === 'forbidden' ? customerProblem('forbidden', '当前会话没有施工主合同读取权限。') : notReady : undefined
        const meta = createReadMeta({ session: actor, schemaVersion: 'customer-read-v2', operation: 'customer:detail', dataOrigin: 'real', asOf, coverage: 'complete', scope: query, sources: [
          { key: 'customers', state: 'readable', sourceVersion: `customer:${row.version}`, asOf },
          projectsProblem ? { key: 'projects', state: projectsProblem.code === 'forbidden' ? 'forbidden' : 'unavailable', sourceVersion: null, asOf: null } : { key: 'projects', state: 'readable', sourceVersion: `projects:${projectRevision}`, asOf },
          construction.source,
          { key: 'receipts', state: 'unavailable', sourceVersion: null, asOf: null },
        ] })
        return withReadMeta(buildCustomerDetailRead({ customers: [customerListRow(row)], projects: projects ?? [], contracts: construction.contracts ?? [], receipts: [], query, ...(projectsProblem ? { projectsProblem } : {}), ...(contractsProblem ? { contractsProblem } : {}), receiptsProblem: notReady, asOf, sourceVersion: meta.sourceVersion, capabilities: meta.capabilities }), meta)
      })
    },
    file(customerId: string, fileId: string, session: ProductionSession) {
      return run(session, false, async (tx) => {
        const owner = await stored(tx, customerId)
        const row = (await tx.select<Record<string, unknown>>('SELECT f.*,p.content,p.sha256 FROM file_refs f JOIN file_payloads p ON p.file_ref_id=f.id WHERE f.id=? AND f.owner_type=\'customer\' AND f.owner_id=? AND f.deleted_at IS NULL', [fileId, customerId]))[0]
        if (owner.deleted_at || !row)
          fail('not-found', '原件不存在或已删除，请从所属客户重新进入。')
        const bytes = row.content
        if (!(bytes instanceof Uint8Array) || bytes.length !== row.file_size || digest(bytes) !== row.sha256)
          fail('unavailable', '原件摘要或正文不一致，停止下载并核对备份。')
        return { ...customerAttachment(row), bytes, sha256: String(row.sha256) }
      })
    },
    audit(customerId: string, session: ProductionSession) {
      return run(session, false, async (tx) => {
        await stored(tx, customerId)
        const rows = await tx.select<{ id: string, actor_id: string, action: string, command_id: string, created_at: string }>('SELECT id,actor_id,action,command_id,created_at FROM customer_audits WHERE customer_id=? ORDER BY created_at,id', [customerId])
        return rows.map(row => ({ id: row.id, actorId: row.actor_id, action: row.action, commandId: row.command_id, createdAt: row.created_at }))
      })
    },
  }
}
