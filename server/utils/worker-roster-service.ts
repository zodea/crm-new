import type { WorkerSourceRow } from '../../app/lib/crew-worker/read-contract'
import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { WorkerPrivateProfile, WorkerRosterArchive, WorkerRosterArchiveSummary, WorkerRosterCommand, WorkerRosterCommandResult, WorkerRosterContext, WorkerRosterMember, WorkerRosterPreview, WorkerRosterResolution, WorkerRosterScope } from '../../app/lib/worker-roster/contract'
import type { BusinessSession } from './business-session'
import { randomUUID } from 'node:crypto'
import { logOperation } from '../../app/lib/db/soft-delete'
import { decodeRosterArchive } from '../../app/lib/worker-roster/codec'
import { EMPTY_WORKER_PRIVATE, rosterProblem, WORKER_PRIVATE_READ } from '../../app/lib/worker-roster/contract'
import { parseRosterCommand, parseRosterScope, rosterCanonical, rosterDate, rosterId } from '../../app/lib/worker-roster/validation'
import { readMigratedWorkerRosterArchive } from './payroll-publication-migration'
import { currentWorkerPrivate, initializeWorkerRosterSchema, insertWorkerPhoto, photoBytes, readWorkerAssetPayload, rosterHash, workerRosterAssets } from './worker-roster-storage'

export interface WorkerRosterSource { workers: WorkerSourceRow[], projects: { id: string, name: string }[] }
export interface WorkerRosterStatement { id: string, projectId: string, status: string, formatFamily: string, members: { workerId: string, workerName: string, isLeader: boolean }[], proof: string }
export interface WorkerRosterServiceOptions {
  session: (sessionId?: string | null) => BusinessSession
  source: (sessionId?: string | null) => WorkerRosterSource | Promise<WorkerRosterSource>
  transaction: <T>(work: (db: TransactionDb) => Promise<T>, sessionId?: string | null) => Promise<T>
  statements: (db: TransactionDb, scope: WorkerRosterScope, sessionId?: string | null) => Promise<WorkerRosterStatement[]>
  now?: () => string
}
const PHOTO_FIELDS = [['portrait', 'portraitId'], ['bank-card', 'bankCardId']] as const
function context(session: BusinessSession): WorkerRosterContext {
  return { ...session, capabilities: [...session.capabilities], origin: 'real' }
}
function authorize(session: BusinessSession, required: string[]) {
  if (!session.capabilities.includes(WORKER_PRIVATE_READ))
    return rosterProblem('forbidden', '当前身份没有工人私密资料读取权限')
  if (required.some(capability => !session.capabilities.includes(capability)))
    return rosterProblem('forbidden', '当前身份没有本项工人或工资操作权限')
}
function siteStatus(worker: WorkerSourceRow, scope: WorkerRosterScope): WorkerRosterMember['siteStatus'] {
  if (worker.currentProjectId !== scope.projectId || !rosterDate(worker.entryDate) || (worker.exitDate && (!rosterDate(worker.exitDate) || worker.exitDate < worker.entryDate)))
    return 'unknown'
  if (worker.entryDate > scope.registeredOn)
    return 'not-entered'
  if (worker.exitDate)
    return worker.exitDate <= scope.registeredOn ? 'left' : 'present'
  return worker.projectStatus === '在场' ? 'present' : 'unknown'
}
export function createWorkerRosterService(options: WorkerRosterServiceOptions) {
  const now = options.now ?? (() => new Date().toISOString())
  async function run<T>(required: string[], sessionId: string | null | undefined, work: (db: TransactionDb, session: BusinessSession, source: WorkerRosterSource) => Promise<T>): Promise<T> {
    return options.transaction(async (db) => {
      const session = structuredClone(options.session(sessionId))
      authorize(session, required)
      const source = structuredClone(await options.source(sessionId))
      await initializeWorkerRosterSchema(db)
      const result = await work(db, session, source)
      if (rosterHash(await options.source(sessionId)) !== rosterHash(source))
        return rosterProblem('stale-source', '读取期间工人资料已变化，请重新核对')
      const current = options.session(sessionId)
      authorize(current, required)
      if (rosterHash(current) !== rosterHash(session))
        return rosterProblem('forbidden', '读取期间工作区、身份或私密权限已变化')
      return result
    }, sessionId)
  }
  async function profile(db: TransactionDb, session: BusinessSession, source: WorkerRosterSource, workerId: string): Promise<WorkerPrivateProfile> {
    if (!rosterId(workerId))
      return rosterProblem('invalid-query', '工人身份无效')
    const worker = source.workers.find(row => row.id === workerId && row.dataOrigin === 'real')
    if (!worker)
      return rosterProblem('not-found', '当前工人资料不可读取')
    const current = await currentWorkerPrivate(db, workerId)
    const assets = await workerRosterAssets(db, workerId)
    return { context: context(session), worker: structuredClone(worker), ...current, assets, sourceVersion: rosterHash({ worker, current, assets }), diagnostics: [] }
  }
  async function preview(db: TransactionDb, session: BusinessSession, source: WorkerRosterSource, input: WorkerRosterScope, sessionId?: string | null): Promise<WorkerRosterPreview> {
    const scope = parseRosterScope(input)
    const project = source.projects.find(row => row.id === scope.projectId)
    if (!project)
      return rosterProblem('not-found', '当前名册项目不可读取')
    const statements = await options.statements(db, scope, sessionId)
    if (statements.length !== scope.statementIds.length || new Set(statements.map(row => row.id)).size !== statements.length || statements.some(row => !scope.statementIds.includes(row.id) || row.projectId !== scope.projectId || row.status !== 'released' || !['A', 'C1', 'C2'].includes(row.formatFamily) || !row.proof || !row.members.length || row.members.some(member => !rosterId(member.workerId) || typeof member.workerName !== 'string') || new Set(row.members.map(member => member.workerId)).size !== row.members.length))
      return rosterProblem('validation-failed', '只能归档同项目、原冻结成员完整的已发 A/C1/C2 工资')
    const identities = new Map<string, { payrollNames: Set<string>, statementIds: Set<string>, isLeader: boolean }>()
    for (const statement of statements) {
      for (const member of statement.members) {
        const entry = identities.get(member.workerId) ?? { payrollNames: new Set(), statementIds: new Set(), isLeader: false }
        entry.payrollNames.add(member.workerName)
        entry.statementIds.add(statement.id)
        entry.isLeader ||= member.isLeader
        identities.set(member.workerId, entry)
      }
    }
    const members: WorkerRosterMember[] = []
    for (const [workerId, identity] of identities) {
      const person = source.workers.find(row => row.id === workerId && row.dataOrigin === 'real')
      const base = { workerId, payrollNames: [...identity.payrollNames].sort(), statementIds: [...identity.statementIds].sort(), isLeader: identity.isLeader }
      if (!person) {
        members.push({ ...base, profile: null, sourceVersion: null, revision: null, values: { ...EMPTY_WORKER_PRIVATE }, photos: [], siteStatus: 'unknown', diagnostics: ['当前工人资料不可用；保留原工资成员'] })
        continue
      }
      const read = await profile(db, session, source, workerId)
      const diagnostics: string[] = []
      for (const [field, label] of [['gender', '性别'], ['hometown', '籍贯'], ['idCard', '身份证号'], ['bankName', '开户行'], ['bankAccount', '银行账号'], ['entryDate', '进场日期']] as const) {
        if (!read.worker[field])
          diagnostics.push(`未记录${label}`)
      }
      if (read.values.laborContractSigned === null)
        diagnostics.push('劳动合同签订情况未记录')
      if (read.values.laborContractSigned === true && !read.values.laborContractSignedOn)
        diagnostics.push('劳动合同签订日期未记录')
      const photos: WorkerRosterMember['photos'] = []
      for (const [purpose, field] of PHOTO_FIELDS) {
        const asset = read.assets.find(row => row.id === read.values[field])
        if (asset)
          photos.push({ ...asset, purpose })
        if (!asset || asset.state !== 'available')
          diagnostics.push(`${purpose === 'portrait' ? '证件照' : '银行卡照'}${asset ? '缺正文' : '未明确关联'}`)
      }
      const status = siteStatus(person, scope)
      if (status === 'unknown')
        diagnostics.push('当前归属或进退场事实不足，登记日期在场状态未知')
      members.push({ ...base, profile: read.worker, revision: read.revision, sourceVersion: read.sourceVersion, values: read.values, photos, siteStatus: status, diagnostics })
    }
    members.sort((a, b) => Number(b.isLeader) - Number(a.isLeader) || a.workerId.localeCompare(b.workerId))
    const counts = { present: members.filter(m => m.siteStatus === 'present').length, left: members.filter(m => m.siteStatus === 'left').length, notEntered: members.filter(m => m.siteStatus === 'not-entered').length, unknown: members.filter(m => m.siteStatus === 'unknown').length }
    return { context: context(session), scope, projectName: project.name, members, counts, sourceVersion: rosterHash({ scope, statements, members }), diagnostics: ['本名册为独立日期的资料补充版本，不证明原工资发放时已保存这些资料。'] }
  }
  async function archive(db: TransactionDb, session: BusinessSession, source: WorkerRosterSource, projectId: string, id: string): Promise<WorkerRosterArchive> {
    if (!rosterId(id) || !rosterId(projectId) || !source.projects.some(p => p.id === projectId))
      return rosterProblem('not-found', '名册归档不存在或不可读取')
    const migrated = await readMigratedWorkerRosterArchive(db, projectId, id)
    if (migrated)
      return { ...migrated, context: context(session) }
    const [stored] = await db.select<{ snapshot_json: string }>('SELECT snapshot_json FROM worker_roster_archives WHERE id=? AND project_id=?', [id, projectId])
    if (!stored)
      return rosterProblem('not-found', '名册归档不存在或不属于当前项目')
    let value: WorkerRosterArchive
    try {
      value = decodeRosterArchive(JSON.parse(stored.snapshot_json), projectId, id)
    }
    catch {
      return rosterProblem('unavailable', '名册归档损坏，请核对原来源')
    }
    return { ...value, context: context(session) }
  }
  return {
    resolve(commandId: string, action: WorkerRosterCommand['action'], sessionId?: string | null): Promise<WorkerRosterResolution> {
      if (!rosterId(commandId) || !['save-profile', 'archive'].includes(action))
        return rosterProblem('invalid-query', '待核对提交身份无效')
      return run(action === 'archive' ? ['payroll:read', 'payroll:write'] : ['worker:write'], sessionId, async (db, session) => {
        const [receipt] = await db.select<{ fingerprint: string, result_json: string }>('SELECT fingerprint,result_json FROM worker_roster_receipts WHERE workspace_id=? AND actor_id=? AND command_id=?', [session.workspaceId, session.actorId, commandId])
        if (receipt) {
          if (receipt.fingerprint === 'cancelled')
            return { state: 'not-applied' }
          const result = JSON.parse(receipt.result_json) as WorkerRosterCommandResult
          if ((action === 'archive') !== (result.archiveId !== null))
            return rosterProblem('conflict', '原提交类型与核对请求不符')
          return { state: 'applied', result }
        }
        // The cancellation receipt shares the command transaction queue: a delayed request cannot apply after this answer.
        await db.execute('INSERT INTO worker_roster_receipts(command_id,workspace_id,actor_id,fingerprint,result_json) VALUES (?,?,?,\'cancelled\',\'null\')', [commandId, session.workspaceId, session.actorId])
        return { state: 'not-applied' }
      })
    },
    profile: (workerId: string, sessionId?: string | null) => run([], sessionId, (db, session, source) => profile(db, session, source, workerId)),
    preview: (scope: WorkerRosterScope, sessionId?: string | null) => run(['payroll:read'], sessionId, (db, session, source) => preview(db, session, source, scope, sessionId)),
    archive: (projectId: string, id: string, sessionId?: string | null) => run(['payroll:read'], sessionId, (db, session, source) => archive(db, session, source, projectId, id)),
    archives(projectId: string, sessionId?: string | null): Promise<WorkerRosterArchiveSummary[]> {
      return run(['payroll:read'], sessionId, async (db, _session, source) => {
        if (!rosterId(projectId) || !source.projects.some(p => p.id === projectId))
          return rosterProblem('not-found', '名册项目不可读取')
        const rows = await db.select<{ id: string, snapshot_json: string }>('SELECT id,snapshot_json FROM worker_roster_archives WHERE project_id=? ORDER BY created_at DESC,version DESC,id', [projectId])
        const summaries: WorkerRosterArchiveSummary[] = []
        for (const { id } of rows) {
          const document = await archive(db, _session, source, projectId, id)
          summaries.push({ id: document.id, version: document.version, projectId, registeredOn: document.scope.registeredOn, createdAt: document.createdAt, statementIds: document.scope.statementIds, memberCount: document.members.length, gapCount: document.members.reduce((sum, member) => sum + member.diagnostics.length, 0) })
        }
        return summaries
      })
    },
    file(input: { workerId: string, assetId: string, projectId?: string, archiveId?: string }, sessionId?: string | null) {
      return run(input.archiveId ? ['payroll:read'] : [], sessionId, async (db, session, source) => {
        let allowed: WorkerPrivateProfile['assets']
        if (input.archiveId) {
          const document = await archive(db, session, source, input.projectId ?? '', input.archiveId)
          allowed = document.members.find(m => m.workerId === input.workerId)?.photos ?? []
        }
        else { allowed = (await profile(db, session, source, input.workerId)).assets }
        const asset = allowed.find(row => row.id === input.assetId && row.workerId === input.workerId)
        if (!asset || asset.state !== 'available')
          return rosterProblem('not-found', '该照片不在当前授权的工人或名册范围内')
        const current = (await workerRosterAssets(db, input.workerId)).find(row => row.id === input.assetId)
        if (!current || rosterHash(current) !== rosterHash(Object.fromEntries(Object.entries(asset).filter(([key]) => key !== 'purpose'))))
          return rosterProblem('unavailable', '归档照片原件与固定版本不一致')
        return { asset, payloadBase64: await readWorkerAssetPayload(db, input.workerId, input.assetId) }
      })
    },
    execute(raw: unknown, sessionId?: string | null): Promise<WorkerRosterCommandResult> {
      const command = parseRosterCommand(raw)
      const required = command.action === 'save-profile' ? ['worker:write'] : ['payroll:read', 'payroll:write']
      return run(required, sessionId, async (db, session, source) => {
        if (command.workspaceId !== session.workspaceId || command.actorId !== session.actorId)
          return rosterProblem('forbidden', '名册提交身份与当前会话不符')
        const fingerprint = rosterHash(command)
        const [receipt] = await db.select<{ fingerprint: string, result_json: string }>('SELECT fingerprint,result_json FROM worker_roster_receipts WHERE workspace_id=? AND actor_id=? AND command_id=?', [session.workspaceId, session.actorId, command.commandId])
        if (receipt) {
          if (receipt.fingerprint !== fingerprint)
            return rosterProblem('conflict', '同一提交编号携带了不同内容')
          return JSON.parse(receipt.result_json) as WorkerRosterCommandResult
        }
        const timestamp = now()
        let result: WorkerRosterCommandResult
        if (command.action === 'save-profile') {
          const read = await profile(db, session, source, command.workerId)
          if (read.sourceVersion !== command.sourceVersion)
            return rosterProblem('stale-source', '工人资料或照片已变化，请保留输入并重新核对')
          const values = { ...command.values }
          for (const [purpose, field] of PHOTO_FIELDS) {
            const upload = command.uploads[purpose]
            if (upload) {
              values[field] = await insertWorkerPhoto(db, command.workerId, upload, session.actorId, timestamp)
            }
            else if (values[field]) {
              const asset = read.assets.find(row => row.id === values[field])
              if (!asset || asset.workerId !== command.workerId || asset.state !== 'available')
                return rosterProblem('validation-failed', '所选照片不存在、缺正文或不属于当前工人')
              photoBytes({ ...asset, fileSize: asset.fileSize ?? -1, payloadBase64: await readWorkerAssetPayload(db, command.workerId, asset.id) })
            }
          }
          const revision = read.revision + 1
          await db.execute('INSERT INTO worker_roster_profile_versions(worker_id,revision,values_json,created_at,actor_id,migration_batch_id) VALUES (?,?,?,?,?,NULL)', [command.workerId, revision, rosterCanonical(values), timestamp, session.actorId])
          result = { commandId: command.commandId, workerId: command.workerId, archiveId: null, revision }
        }
        else {
          const read = await preview(db, session, source, command.scope, sessionId)
          if (read.sourceVersion !== command.sourceVersion)
            return rosterProblem('stale-source', '工资成员、工人资料或照片已变化，请重新核对名册')
          const scopeKey = rosterHash({ projectId: read.scope.projectId, statementIds: read.scope.statementIds })
          const [last] = await db.select<{ version: number }>('SELECT MAX(version) AS version FROM worker_roster_archives WHERE scope_key=?', [scopeKey])
          const revision = (last?.version ?? 0) + 1
          const document: WorkerRosterArchive = { ...read, id: `worker-roster-${randomUUID()}`, version: revision, createdAt: timestamp, createdBy: session.actorId, evidenceKind: 'dated-supplement' }
          await db.execute('INSERT INTO worker_roster_archives(id,project_id,scope_key,version,snapshot_json,created_at) VALUES (?,?,?,?,?,?)', [document.id, document.scope.projectId, scopeKey, revision, rosterCanonical(document), timestamp])
          result = { commandId: command.commandId, workerId: null, archiveId: document.id, revision }
        }
        await db.execute('INSERT INTO worker_roster_receipts(command_id,workspace_id,actor_id,fingerprint,result_json,worker_id,archive_id) VALUES (?,?,?,?,?,?,?)', [command.commandId, session.workspaceId, session.actorId, fingerprint, JSON.stringify(result), result.workerId, result.archiveId])
        await logOperation(db, { table: command.action === 'archive' ? 'worker_roster_archives' : 'worker_roster_profile_versions', recordId: result.archiveId ?? result.workerId!, action: 'create', after: { revision: result.revision }, operator: session.actorId })
        return result
      })
    },
  }
}
