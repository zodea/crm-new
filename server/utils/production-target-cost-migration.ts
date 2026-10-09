import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BudgetMigrationRow } from '../../app/lib/migration/target-cost-source'
import type { BudgetImportCommand, BudgetImportPreview, BudgetImportResult } from '../../app/lib/target-cost/import-contract'
import type { BusinessSession } from './business-session'
import type { ProductionStorage } from './production-storage'
import { Buffer } from 'node:buffer'
import { LATEST_VERSION } from '../../app/lib/db/migrations'
import { BUDGET_MIGRATION_COLUMNS, budgetLogBelongs, budgetLogSnapshot, parseBudgetVersionGraph } from '../../app/lib/migration/target-cost-source'
import { targetCostProblem } from '../../app/lib/target-cost/central-contract'
import { withVerifiedMigrationSnapshot } from './migration-snapshot'
import { budgetBytesDigest, budgetDigest } from './production-target-cost-files'
import { advanceProductionBudgetVersion, productionBudgetGraph, productionBudgetProjectRows, verifyProductionBudgetState } from './production-target-cost-state'

type Row = Record<string, unknown>
type Session = () => BusinessSession
interface Source { sha256: string, schemaVersion: number, heads: Row[], items: Row[], files: Array<{ row: Row, payloadBase64: string | null, bodyState: 'embedded' | 'metadata-only' | 'external-required' }>, payloads: Row[], logs: Row[], projects: Row[], extensions: Record<string, unknown>, schema: Row[] }
function fail(message: string): never {
  throw targetCostProblem('validation-failed', `预算迁入：${message}`)
}
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
function request(input: unknown): BudgetImportCommand {
  if (!object(input) || Object.keys(input).some(key => !['commandId', 'workspaceId', 'actorId', 'source', 'mappings', 'originals'].includes(key)) || !['commandId', 'workspaceId', 'actorId'].every(key => typeof input[key] === 'string' && String(input[key]).trim()) || !/^[a-z0-9][\w-]{2,79}$/i.test(String(input.commandId)) || !object(input.source) || !Array.isArray(input.mappings) || input.mappings.some(row => !object(row) || Object.keys(row).sort().join(',') !== 'legacyProjectId,projectId,version' || !['legacyProjectId', 'projectId', 'version'].every(key => typeof row[key] === 'string' && String(row[key]).trim())) || (input.originals !== undefined && (!Array.isArray(input.originals) || input.originals.some(row => !object(row) || Object.keys(row).sort().join(',') !== 'fileId,payloadBase64' || typeof row.fileId !== 'string' || typeof row.payloadBase64 !== 'string'))))
    return fail('完整字节、原编号或显式项目映射格式无效')
  const command = input as unknown as BudgetImportCommand
  if (new Set(command.mappings.map(row => row.legacyProjectId)).size !== command.mappings.length || new Set((command.originals ?? []).map(row => row.fileId)).size !== (command.originals ?? []).length)
    return fail('项目映射或补传原件身份重复')
  return command
}
/** Unknown columns retain their SQLite storage class and exact value, including 64-bit INTEGER and BLOB. */
async function preserveExtensions(tx: TransactionDb, table: string, rows: Row[], known: readonly string[], rowKey = 'id') {
  const columns = (await tx.select<{ name: string, type: string, notnull: number, dflt_value: unknown }>(`PRAGMA table_info("${table}")`)).filter(column => !known.includes(column.name))
  const facts: Record<string, unknown> = {}
  for (const row of rows) {
    const values: Record<string, unknown> = {}
    for (const column of columns) {
      const identifier = `"${column.name.replace(/"/g, '""')}"`
      const encoded = (await tx.select<{ storage_type: string, exact_value: string | null }>(`SELECT typeof(${identifier}) AS storage_type,CASE typeof(${identifier})
        WHEN 'blob' THEN hex(${identifier}) WHEN 'integer' THEN CAST(${identifier} AS TEXT)
        WHEN 'real' THEN printf('%!.26g',${identifier}) ELSE ${identifier} END AS exact_value FROM "${table}" WHERE "${rowKey}"=?`, [row[rowKey]]))[0]!
      values[column.name] = encoded
      if (encoded.storage_type === 'blob')
        row[column.name] = { sqliteType: 'blob', hex: encoded.exact_value }
      else if (encoded.storage_type === 'integer' && !Number.isSafeInteger(row[column.name]))
        row[column.name] = { sqliteType: 'integer', text: encoded.exact_value }
      else if (encoded.storage_type === 'real' && !Number.isFinite(row[column.name]))
        row[column.name] = { sqliteType: 'real', text: encoded.exact_value }
    }
    facts[String(row[rowKey])] = values
  }
  return { columns, rows: facts }
}
async function readSource(tx: TransactionDb, evidence: { sha256: string, schemaVersion: number }): Promise<Source> {
  if (evidence.schemaVersion < 20 || evidence.schemaVersion > LATEST_VERSION)
    return fail('此来源版本尚未核验，请保留原库，不升级来源')
  const heads = await tx.select<Row>('SELECT * FROM target_costs ORDER BY id')
  const items = await tx.select<Row>('SELECT * FROM target_cost_items ORDER BY id')
  const rawFiles = await tx.select<Row>('SELECT * FROM file_refs WHERE owner_type=\'target_cost\' ORDER BY id')
  const payloads = await tx.select<Row>('SELECT p.* FROM file_payloads p JOIN file_refs f ON f.id=p.file_ref_id WHERE f.owner_type=\'target_cost\' ORDER BY p.file_ref_id')
  const allLogs = await tx.select<Row>('SELECT * FROM operation_logs WHERE table_name IN (\'target_costs\',\'target_cost_items\',\'file_refs\') ORDER BY id')
  const logs = allLogs.filter(log => heads.some(head => budgetLogBelongs(log as BudgetMigrationRow, { head: head as BudgetMigrationRow, items: items.filter(item => item.target_cost_id === head.id) as BudgetMigrationRow[], files: rawFiles.filter(file => file.owner_id === head.id) as BudgetMigrationRow[] })))
  if (items.some(item => !heads.some(head => head.id === item.target_cost_id)) || rawFiles.some(file => !heads.some(head => head.id === file.owner_id)))
    return fail('明细或附件缺少真实版本祖先，不能截取有效部分')
  for (const head of heads) {
    const pick = (row: Row, part: keyof typeof BUDGET_MIGRATION_COLUMNS) => Object.fromEntries(BUDGET_MIGRATION_COLUMNS[part].map(key => [key, row[key]]))
    try {
      parseBudgetVersionGraph({ schemaVersion: 1, head: pick(head, 'head'), items: items.filter(row => row.target_cost_id === head.id).map(row => pick(row, 'items')), files: rawFiles.filter(row => row.owner_id === head.id).map(row => pick(row, 'files')), payloads: payloads.filter(row => rawFiles.some(file => file.owner_id === head.id && file.id === row.file_ref_id)).map(row => pick(row, 'payloads')), logs: logs.filter(log => budgetLogBelongs(log as BudgetMigrationRow, { head: head as BudgetMigrationRow, items: items.filter(row => row.target_cost_id === head.id) as BudgetMigrationRow[], files: rawFiles.filter(row => row.owner_id === head.id) as BudgetMigrationRow[] })).map(row => pick(row, 'logs')) })
    }
    catch (cause) { return fail(cause instanceof Error ? cause.message : '完整版本图不合法') }
  }
  const files = rawFiles.map(row => ({ row, payloadBase64: payloads.find(body => body.file_ref_id === row.id)?.content as string | undefined ?? null, bodyState: payloads.some(body => body.file_ref_id === row.id) ? 'embedded' as const : row.file_path ? 'external-required' as const : 'metadata-only' as const }))
  const projects = (await tx.select<Row>('SELECT id,name,deleted_at FROM projects ORDER BY id')).filter(row => heads.some(head => head.project_id === row.id) || logs.some(log => [log.before_data, log.after_data].some(value => budgetLogSnapshot(value)?.project_id === row.id)))
  if (heads.some(head => head.project_id !== null && !projects.some(project => project.id === head.project_id)))
    return fail('预算所属原项目缺失')
  const extensions = {
    target_costs: await preserveExtensions(tx, 'target_costs', heads, BUDGET_MIGRATION_COLUMNS.head),
    target_cost_items: await preserveExtensions(tx, 'target_cost_items', items, BUDGET_MIGRATION_COLUMNS.items),
    file_refs: await preserveExtensions(tx, 'file_refs', rawFiles, BUDGET_MIGRATION_COLUMNS.files),
    file_payloads: await preserveExtensions(tx, 'file_payloads', payloads, BUDGET_MIGRATION_COLUMNS.payloads, 'file_ref_id'),
    operation_logs: await preserveExtensions(tx, 'operation_logs', logs, BUDGET_MIGRATION_COLUMNS.logs),
  }
  const schema = await tx.select<Row>('SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name IN (\'target_costs\',\'target_cost_items\',\'file_refs\',\'file_payloads\',\'operation_logs\') AND sql IS NOT NULL ORDER BY tbl_name,type,name')
  return { ...evidence, heads, items, files, payloads, logs, projects, extensions, schema }
}
async function projectMapping(tx: TransactionDb, source: Source, command: BudgetImportCommand) {
  const mapped = new Map<string, string>()
  for (const project of source.projects) {
    const mapping = command.mappings.find(row => row.legacyProjectId === project.id)
    const row = mapping ? (await productionBudgetProjectRows(tx, mapping.projectId))[0] : null
    if (!mapping || !row || String(row.version) !== mapping.version)
      return fail('每个当前及历史项目须有稳定 ID 和真实版本映射')
    mapped.set(String(project.id), row.id)
  }
  if (command.mappings.some(row => !mapped.has(row.legacyProjectId)))
    return fail('映射包含来源未采用的项目')
  return mapped
}
function mappedRow(row: Row, map: ReadonlyMap<string, string>) {
  if (row.project_id != null && !map.has(String(row.project_id)))
    return fail('历史项目引用缺少明确映射')
  return row.project_id == null ? { ...row } : { ...row, project_id: map.get(String(row.project_id)) }
}
async function insert(tx: TransactionDb, table: string, row: Row, columns: readonly string[]) {
  const entries = columns.map(key => [key, row[key]] as const)
  await tx.execute(`INSERT INTO ${table}(${entries.map(([key]) => key).join(',')}) VALUES (${entries.map(() => '?').join(',')})`, entries.map(([, value]) => value))
}
export function createProductionBudgetMigration(storage: ProductionStorage) {
  async function run<T>(session: Session, work: (tx: TransactionDb, actor: BusinessSession) => Promise<T>, write = false) {
    const original = structuredClone(session())
    if (original.workspaceId !== storage.identity.workspaceId || original.actorId !== storage.identity.actorId || !original.capabilities.includes('target-cost:import') || !original.capabilities.includes('target-cost:read'))
      throw targetCostProblem('forbidden', '当前可信身份无权接管或恢复预算')
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      await verifyProductionBudgetState(tx)
      const result = await work(tx, original)
      if (budgetDigest(original) !== budgetDigest(session()))
        throw targetCostProblem('forbidden', '预算迁入期间身份或权限已变化')
      return result
    })
  }
  async function withSource<T>(input: unknown, session: Session, work: (source: Source, command: BudgetImportCommand, tx: TransactionDb, actor: BusinessSession) => Promise<T>, write = false) {
    const command = request(input)
    const actor = session()
    if (!actor.capabilities.includes('target-cost:import') || actor.workspaceId !== command.workspaceId || actor.actorId !== command.actorId)
      throw targetCostProblem('forbidden', '预算迁入命令身份与当前会话不匹配')
    return withVerifiedMigrationSnapshot(command.source, async (native, evidence) => {
      const source = await readSource(native, evidence)
      return run(session, (tx, actor) => work(source, command, tx, actor), write)
    })
  }
  return {
    state(session: Session) {
      return run(session, async (tx, actor) => ({ context: actor, sources: (await tx.select<{ id: string, source_sha256: string, result_json: string, imported_at: string, restored_at: string | null }>('SELECT i.id,i.source_sha256,i.result_json,i.imported_at,r.restored_at FROM target_cost_imports i LEFT JOIN target_cost_import_restores r ON r.import_id=i.id ORDER BY i.imported_at,i.id')).map(row => ({ importId: row.id, sourceSha256: row.source_sha256, ids: (JSON.parse(row.result_json) as BudgetImportResult).ids, importedAt: row.imported_at, restored: row.restored_at !== null })) }))
    },
    preflight(input: unknown, session: Session): Promise<BudgetImportPreview> {
      return withSource(input, session, async (source, _command, tx, actor) => ({ sourceSha256: source.sha256, schemaVersion: source.schemaVersion, versions: source.heads.map(row => ({ id: String(row.id), name: String(row.name), legacyProjectId: row.project_id == null ? null : String(row.project_id) })), references: source.projects.map(row => ({ id: String(row.id), name: String(row.name) })), projects: actor.capabilities.includes('project:list:read') ? (await productionBudgetProjectRows(tx)).map(row => ({ id: row.id, name: row.name, version: String(row.version), deletedAt: row.deleted_at })) : [], requiredOriginals: source.files.filter(row => row.bodyState === 'external-required').map(row => ({ id: String(row.row.id), name: String(row.row.file_name ?? '') })) }))
    },
    adopt(input: unknown, session: Session): Promise<BudgetImportResult> {
      return withSource(input, session, async (source, command, tx, actor) => {
        const fingerprint = budgetDigest(command)
        const oldCommand = (await tx.select<{ fingerprint: string, result_json: string }>('SELECT * FROM target_cost_import_commands WHERE command_id=?', [command.commandId]))[0]
        if (oldCommand) {
          if (oldCommand.fingerprint !== fingerprint)
            throw targetCostProblem('conflict', '原预算迁入编号不能改用其他来源或映射')
          return JSON.parse(oldCommand.result_json)
        }
        if ((await tx.select('SELECT command_id FROM target_cost_import_resolutions WHERE command_id=?', [command.commandId]))[0])
          throw targetCostProblem('conflict', '原迁入编号已经封存，迟到请求不能再应用')
        const inputBasis = budgetDigest({ sha256: source.sha256, mappings: command.mappings.toSorted((a, b) => a.legacyProjectId.localeCompare(b.legacyProjectId)), originals: command.originals ?? [] })
        const prior = (await tx.select<{ id: string, fingerprint: string, result_json: string }>('SELECT * FROM target_cost_imports WHERE source_sha256=?', [source.sha256]))[0]
        if (prior) {
          if (prior.fingerprint !== inputBasis || (await tx.select('SELECT import_id FROM target_cost_import_restores WHERE import_id=?', [prior.id]))[0])
            throw targetCostProblem('conflict', '同一原库已接管或恢复，不能改变映射或覆盖后来事实')
          const result = { ...JSON.parse(prior.result_json), commandId: command.commandId } as BudgetImportResult
          await tx.execute('INSERT INTO target_cost_import_commands VALUES (?,?,?,?,?,?)', [command.commandId, actor.workspaceId, actor.actorId, 'adopt', fingerprint, JSON.stringify(result)])
          return result
        }
        const mapping = await projectMapping(tx, source, command)
        for (const file of command.originals ?? []) {
          if (!source.files.some(row => row.row.id === file.fileId))
            return fail('补传原件不属于来源预算')
        }
        for (const row of source.heads)
          await insert(tx, 'target_costs', mappedRow(row, mapping), BUDGET_MIGRATION_COLUMNS.head)
        for (const row of source.items)
          await insert(tx, 'target_cost_items', row, BUDGET_MIGRATION_COLUMNS.items)
        const evidence = { ...source, files: source.files.map(({ payloadBase64: _body, ...file }) => file), payloads: source.payloads.map(({ content, ...row }) => ({ ...row, sha256: budgetBytesDigest(Buffer.from(String(content), 'base64')) })), mapping: command.mappings, installedFingerprints: {} as Record<string, string>, installedLogs: [] as Row[] }
        for (const file of source.files) {
          const provided = command.originals?.find(row => row.fileId === file.row.id)?.payloadBase64
          if (provided && file.payloadBase64 && provided !== file.payloadBase64)
            return fail('补传正文与原库已有原件不一致')
          const encoded = file.payloadBase64 ?? provided ?? null
          if (encoded === null && file.bodyState === 'external-required')
            return fail('来源保存了外部路径，须补齐真实原件，不能把路径当作历史缺件')
          const bytes = encoded === null ? null : Buffer.from(encoded, 'base64')
          if (bytes && (bytes.toString('base64') !== encoded || (file.row.file_size !== null && bytes.length !== file.row.file_size)))
            return fail('实际原件正文或长度不一致')
          const row = file.row
          const sha256 = bytes ? budgetBytesDigest(bytes) : null
          await tx.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,uploaded_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [row.id, 'target_cost', row.owner_id, row.file_name ?? '', row.file_path ?? '', bytes?.length ?? row.file_size ?? 0, row.mime_type ?? '', row.category ?? '', row.uploader ?? '', row.uploaded_at ?? '', row.deleted_at])
          await tx.execute('INSERT INTO target_cost_files VALUES (?,?,?,?,?)', [row.id, row.owner_id, JSON.stringify(row), bytes ? 'embedded' : 'metadata-only', sha256])
          if (bytes)
            await tx.execute('INSERT INTO file_payloads VALUES (?,?,?)', [row.id, bytes, sha256])
        }
        for (const row of source.logs) {
          const mapped = { ...row, created_at: row.created_at ?? '', operator: row.operator ?? '' }
          for (const field of ['before_data', 'after_data']) {
            const snapshot = budgetLogSnapshot(row[field])
            if (snapshot)
              Object.assign(mapped, { [field]: JSON.stringify(mappedRow(snapshot, mapping)) })
          }
          await insert(tx, 'operation_logs', mapped, BUDGET_MIGRATION_COLUMNS.logs)
          evidence.installedLogs.push(Object.fromEntries(BUDGET_MIGRATION_COLUMNS.logs.map(key => [key, mapped[key as keyof typeof mapped]])))
        }
        for (const row of source.heads) {
          await advanceProductionBudgetVersion(tx, String(row.id))
          evidence.installedFingerprints[String(row.id)] = budgetDigest(await productionBudgetGraph(tx, String(row.id)))
        }
        const result: BudgetImportResult = { commandId: command.commandId, importId: `budget-import-${source.sha256}`, ids: source.heads.map(row => String(row.id)), sourceSha256: source.sha256 }
        await tx.execute('INSERT INTO target_cost_imports VALUES (?,?,?,?,?,?,?,?,?,?)', [result.importId, command.commandId, actor.workspaceId, actor.actorId, source.sha256, inputBasis, JSON.stringify(evidence), budgetDigest(evidence), JSON.stringify(result), new Date().toISOString()])
        await tx.execute('INSERT INTO target_cost_import_commands VALUES (?,?,?,?,?,?)', [command.commandId, actor.workspaceId, actor.actorId, 'adopt', fingerprint, JSON.stringify(result)])
        await verifyProductionBudgetState(tx)
        return result
      }, true)
    },
    restore(input: { commandId: string, workspaceId: string, actorId: string, importId: string }, session: Session): Promise<BudgetImportResult> {
      return run(session, async (tx, actor) => {
        if (input.workspaceId !== actor.workspaceId || input.actorId !== actor.actorId || !/^[a-z0-9][\w-]{2,79}$/i.test(input.commandId))
          throw targetCostProblem('forbidden', '恢复编号与身份不匹配')
        const fingerprint = budgetDigest(input)
        const previous = (await tx.select<{ fingerprint: string, result_json: string }>('SELECT * FROM target_cost_import_commands WHERE command_id=?', [input.commandId]))[0]
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            throw targetCostProblem('conflict', '原恢复编号不能改用另一批来源')
          return JSON.parse(previous.result_json)
        }
        if ((await tx.select('SELECT command_id FROM target_cost_import_resolutions WHERE command_id=?', [input.commandId]))[0])
          throw targetCostProblem('conflict', '原恢复编号已封存')
        const imported = (await tx.select<{ evidence_json: string, source_sha256: string }>('SELECT * FROM target_cost_imports WHERE id=?', [input.importId]))[0]
        if (!imported || (await tx.select('SELECT import_id FROM target_cost_import_restores WHERE import_id=?', [input.importId]))[0])
          throw targetCostProblem('conflict', '原接管批次不存在或已经恢复')
        const evidence = JSON.parse(imported.evidence_json)
        const ids = Object.keys(evidence.installedFingerprints)
        for (const id of ids) {
          if (budgetDigest(await productionBudgetGraph(tx, id)) !== evidence.installedFingerprints[id] || (await tx.select('SELECT command_id FROM target_cost_commands WHERE target_cost_id=?', [id])).length)
            throw targetCostProblem('conflict', '预算迁入后已有真实更正或原命令，危险恢复整批拒绝，已保留全部事实')
        }
        for (const original of evidence.installedLogs) {
          const row = (await tx.select('SELECT * FROM operation_logs WHERE id=?', [original.id]))[0]
          if (budgetDigest(row) !== budgetDigest(original))
            throw targetCostProblem('conflict', '原预算审计已变化，恢复整批拒绝')
        }
        // Retirement removes formal adoption, while the only original bytes and source history stay recoverable.
        // External originals supplied during adoption are absent from the source SQLite bytes; never delete them.
        for (const id of ids) {
          await tx.execute('UPDATE target_costs SET deleted_at=COALESCE(deleted_at,?) WHERE id=?', [new Date().toISOString(), id])
          await advanceProductionBudgetVersion(tx, id)
        }
        const result: BudgetImportResult = { commandId: input.commandId, importId: input.importId, ids, sourceSha256: imported.source_sha256, restored: true }
        await tx.execute('INSERT INTO target_cost_import_restores VALUES (?,?,?,?,?,?)', [input.importId, input.commandId, actor.workspaceId, actor.actorId, JSON.stringify(result), new Date().toISOString()])
        await tx.execute('INSERT INTO target_cost_import_commands VALUES (?,?,?,?,?,?)', [input.commandId, actor.workspaceId, actor.actorId, 'restore', fingerprint, JSON.stringify(result)])
        return result
      }, true)
    },
    resolve(input: { commandId: string, workspaceId: string, actorId: string }, session: Session) {
      return run(session, async (tx, actor) => {
        if (input.workspaceId !== actor.workspaceId || input.actorId !== actor.actorId || !/^[a-z0-9][\w-]{2,79}$/i.test(input.commandId))
          throw targetCostProblem('forbidden', '原迁入编号与身份不匹配')
        const command = (await tx.select<{ result_json: string }>('SELECT result_json FROM target_cost_import_commands WHERE command_id=?', [input.commandId]))[0]
        if (command)
          return { outcome: 'applied' as const, result: JSON.parse(command.result_json) as BudgetImportResult }
        await tx.execute('INSERT OR IGNORE INTO target_cost_import_resolutions VALUES (?,?,?,?)', [input.commandId, actor.workspaceId, actor.actorId, new Date().toISOString()])
        return { outcome: 'not-applied' as const, commandId: input.commandId }
      }, true)
    },
  }
}
