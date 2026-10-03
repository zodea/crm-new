import type { ProductionBackupCommand, ProductionBackupRun, ProductionBackupStatus } from '../../app/lib/production/backup-contract'
import type { BusinessSession } from './business-session'
import type { ProductionBackupConfig } from './production-backup-config'
import type { ProductionBackupPackage } from './production-backup-package'
import type { ProductionStorage } from './production-storage'
import { randomUUID } from 'node:crypto'
import { backupDigest, backupInvalid } from './production-backup-manifest'
import { backupInventoryDigest, copyBackupPackage, createLocalBackup, readBackupPackage, restoreBackupIsolated } from './production-backup-package'
import { backupProtection, backupShouldRun } from './production-backup-policy'
import { pruneProductionBackups } from './production-backup-retention'
import { productionStorageManifest } from './production-storage-schema'

type Session = () => BusinessSession
interface RunRow {
  id: string
  action: ProductionBackupCommand['action']
  source_backup_id: string | null
  fingerprint: string
  actor_id: string
  state: ProductionBackupRun['state']
  started_at: string
  completed_at: string | null
  captured_at: string | null
  package_id: string | null
  error_message: string | null
  result_json: string | null
}
const idPattern = /^[a-z0-9][\w-]{2,79}$/i
const packagePattern = /^backup-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const participantDigest = (value: ProductionBackupPackage['inventory']['participants']) => backupDigest(JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))))
const toRun = (row: RunRow): ProductionBackupRun => ({ commandId: row.id, action: row.action, state: row.state, startedAt: row.started_at, completedAt: row.completed_at, capturedAt: row.captured_at, packageId: row.package_id, message: row.error_message })
export function parseBackupCommand(value: unknown): ProductionBackupCommand {
  const row = value as Partial<ProductionBackupCommand> | null
  if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).sort().join(',') !== 'action,commandId,sourceBackupId'
    || typeof row.commandId !== 'string' || !idPattern.test(row.commandId)
    || !['backup', 'copy-offline', 'verify-restore'].includes(String(row.action))
    || (row.action === 'backup' ? row.sourceBackupId !== null : typeof row.sourceBackupId !== 'string' || !packagePattern.test(row.sourceBackupId))) {
    backupInvalid('备份操作内容或原提交编号无效；不能指定任意路径或操作者。')
  }
  return row as ProductionBackupCommand
}

/** Coordinates long filesystem work outside SQL transactions, with durable intent and terminal receipts. */
export function createProductionBackupService(storage: ProductionStorage, config: ProductionBackupConfig | null, now = () => new Date().toISOString()) {
  let active = false
  let initialized: Promise<void> | null = null
  function authorize(session: Session) {
    const actor = session()
    if (actor.actorId !== storage.identity.actorId || actor.workspaceId !== storage.identity.workspaceId)
      backupInvalid('当前维护人或工作区不能操作这些备份。')
    return actor
  }
  function initialize() {
    // Once per process/service. Interrupted work is never silently relabelled successful.
    initialized ??= storage.execute('UPDATE production_backup_runs SET state=\'failed\',completed_at=?,error_message=? WHERE state=\'running\'', [now(), '上次服务在操作完成确认前停止；保留已有副本，请重新执行并验证。']).catch((cause) => {
      initialized = null
      throw cause
    })
    return initialized
  }
  async function readStatus(): Promise<ProductionBackupStatus> {
    await initialize()
    const rows = await storage.select<RunRow>('SELECT * FROM production_backup_runs ORDER BY rowid DESC')
    const latest = rows.find(row => row.action === 'backup' && row.state === 'succeeded')
    const offline = rows.find(row => row.action === 'copy-offline' && row.state === 'succeeded')
    const lastAttempt = rows.find(row => row.action === 'backup' && row.state !== 'running')
    const baseline = (await storage.select<{ package_id: string, captured_at: string, restored_at: string, schema_version: number, participants_sha256: string }>('SELECT * FROM production_backup_baseline WHERE singleton=1'))[0]
    const currentVersion = (await storage.status()).schemaVersion
    return {
      workspaceId: storage.identity.workspaceId,
      ownerId: storage.identity.actorId,
      configured: !!config,
      protection: backupProtection({ configured: !!config, capturedAt: latest?.captured_at ?? null, lastFailure: lastAttempt?.state === 'failed' ? lastAttempt.error_message : null }, Date.parse(now())),
      intervalHours: config?.intervalHours ?? 12,
      latest: latest ? toRun(latest) : null,
      offline: offline ? toRun(offline) : null,
      baseline: baseline ? { packageId: baseline.package_id, capturedAt: baseline.captured_at, restoredAt: baseline.restored_at, schemaVersion: baseline.schema_version, current: baseline.schema_version === currentVersion && baseline.participants_sha256 === participantDigest(productionStorageManifest(currentVersion).participants) } : null,
      running: active || rows.some(row => row.state === 'running'),
      recent: rows.slice(0, 10).map(toRun),
      releaseState: 'awaiting-final-acceptance',
    }
  }
  async function execute(value: unknown, session: Session): Promise<ProductionBackupRun> {
    const command = parseBackupCommand(value)
    const actor = authorize(session)
    if (!config)
      backupInvalid('备份位置尚未配置，请维护人配置独立介质与隔离恢复位置。')
    await initialize()
    const fingerprint = backupDigest(JSON.stringify([command, config, storage.identity]))
    const previous = (await storage.select<RunRow>('SELECT * FROM production_backup_runs WHERE id=?', [command.commandId]))[0]
    if (previous) {
      if (previous.fingerprint !== fingerprint || previous.actor_id !== actor.actorId)
        backupInvalid('同一备份提交编号不能改用其他内容或配置。')
      return toRun(previous)
    }
    if (active)
      backupInvalid('另一项备份操作正在进行，请等待其结果。')
    active = true
    const packageId = command.action === 'backup' ? `backup-${randomUUID()}` : command.sourceBackupId!
    try {
      await storage.withTransaction(async (tx) => {
        authorize(session)
        const prior = (await tx.select<{ captured_at: string }>('SELECT captured_at FROM production_backup_runs WHERE action=\'backup\' AND state=\'succeeded\' ORDER BY rowid DESC LIMIT 1'))[0]
        const startedAt = now()
        const overdue = command.action === 'backup' && prior && Date.parse(startedAt) - Date.parse(prior.captured_at) > 24 * 60 * 60 * 1000
        await tx.execute('INSERT INTO production_backup_runs(id,action,source_backup_id,fingerprint,actor_id,state,started_at,package_id,error_message) VALUES(?,?,?,?,?,\'running\',?,?,?)', [command.commandId, command.action, command.sourceBackupId, fingerprint, actor.actorId, startedAt, packageId, overdue ? '执行前曾超过 24 小时没有新成功备份；此次补跑不消除此前保护失效的时段。' : null])
        authorize(session)
      })
      let pack: ProductionBackupPackage
      let restored = false
      if (command.action === 'backup') {
        await createLocalBackup(storage, config.stagingDirectory, packageId, now)
        authorize(session)
        pack = await copyBackupPackage(config.stagingDirectory, config.primaryDirectory, packageId)
      }
      else {
        // Only a prior successful primary receipt can be selected; arbitrary directories never enter.
        const source = (await storage.select<RunRow>('SELECT * FROM production_backup_runs WHERE action=\'backup\' AND state=\'succeeded\' AND package_id=?', [packageId]))[0]
        if (!source)
          backupInvalid('所选备份没有当前工作区的成功记录。')
        pack = await readBackupPackage(config.primaryDirectory, packageId)
        const current = await storage.status()
        const receipt = source.result_json ? JSON.parse(source.result_json) : null
        if (pack.inventory.workspaceId !== storage.identity.workspaceId || pack.inventory.ownerId !== storage.identity.actorId || pack.inventory.purpose !== current.purpose)
          backupInvalid('所选备份不属于当前工作区。')
        if (!receipt || receipt.packageId !== packageId || receipt.inventoryDigest !== backupInventoryDigest(pack.inventory) || source.captured_at !== pack.capturedAt)
          backupInvalid('所选备份与原成功回执不一致。')
        if (command.action === 'verify-restore' && pack.inventory.schemaVersion !== current.schemaVersion)
          backupInvalid('所选备份版本与当前发布物不同，请使用匹配版本在独立维护流程恢复。')
        if (command.action === 'copy-offline') {
          pack = await copyBackupPackage(config.primaryDirectory, config.offlineDirectory, packageId)
        }
        else {
          await restoreBackupIsolated(config.primaryDirectory, packageId, config.restoreDirectory, command.commandId)
          restored = true
        }
      }
      const completed = now()
      await storage.withTransaction(async (tx) => {
        authorize(session)
        await tx.execute('UPDATE production_backup_runs SET state=\'succeeded\',completed_at=?,captured_at=?,result_json=? WHERE id=? AND state=\'running\'', [completed, pack.capturedAt, JSON.stringify({ packageId, inventoryDigest: backupInventoryDigest(pack.inventory) }), command.commandId])
        if (restored) {
          await tx.execute('INSERT INTO production_backup_baseline VALUES(1,?,?,?,?,?,?,?) ON CONFLICT(singleton) DO UPDATE SET package_id=excluded.package_id,database_sha256=excluded.database_sha256,captured_at=excluded.captured_at,restored_at=excluded.restored_at,schema_version=excluded.schema_version,participants_sha256=excluded.participants_sha256,proof_command_id=excluded.proof_command_id', [packageId, pack.inventory.databaseSha256, pack.capturedAt, completed, pack.inventory.schemaVersion, participantDigest(pack.inventory.participants), command.commandId])
        }
        authorize(session)
      })
      if (command.action !== 'verify-restore') {
        // A cleanup failure does not erase a successful verified backup or its receipt.
        try {
          const runs = await storage.select<RunRow>('SELECT * FROM production_backup_runs WHERE action=? AND state=\'succeeded\' ORDER BY rowid DESC', [command.action])
          const baseline = (await storage.select<{ package_id: string }>('SELECT package_id FROM production_backup_baseline WHERE singleton=1'))[0]
          const protectedIds = new Set([packageId, ...(baseline ? [baseline.package_id] : [])])
          const candidates = runs.map(row => ({ id: row.package_id!, capturedAt: row.captured_at! }))
          const roots = command.action === 'backup' ? [config.primaryDirectory, config.stagingDirectory] : [config.offlineDirectory]
          for (const root of roots) {
            const result = await pruneProductionBackups(root, candidates, protectedIds, config)
            if (result.skipped.length)
              throw new Error('retention skipped unverified package')
          }
        }
        catch {
          await storage.execute('UPDATE production_backup_runs SET error_message=COALESCE(error_message||\'；\',\'\')||? WHERE id=?', ['备份已完成；部分旧副本未通过清理核对，已保留，请维护人检查。', command.commandId])
        }
      }
    }
    catch (cause) {
      // Paths and raw filesystem errors may contain private machine details. Keep the public diagnostic bounded.
      const message = cause instanceof Error && cause.name === 'ProductionStorageProblem' ? cause.message : '备份位置不可用、空间不足或操作未完成；已有成功副本保留，请核对介质后重试。'
      await storage.execute('UPDATE production_backup_runs SET state=\'failed\',completed_at=?,error_message=? WHERE id=? AND state=\'running\'', [now(), message, command.commandId])
      const failed = (await storage.select<RunRow>('SELECT * FROM production_backup_runs WHERE id=?', [command.commandId]))[0]
      if (!failed)
        throw cause
    }
    finally { active = false }
    authorize(session)
    return toRun((await storage.select<RunRow>('SELECT * FROM production_backup_runs WHERE id=?', [command.commandId]))[0]!)
  }
  const maintenance = () => ({ ...storage.identity, capabilities: [] })
  return {
    async status(session: Session) {
      authorize(session)
      const status = await readStatus()
      authorize(session)
      return status
    },
    execute,
    async scheduled() {
      const status = await readStatus()
      const attempted = (await storage.select<{ started_at: string }>('SELECT started_at FROM production_backup_runs WHERE action=\'backup\' ORDER BY rowid DESC LIMIT 1'))[0]
      if (backupShouldRun({ configured: !!config, running: active, lastCapturedAt: status.latest?.capturedAt ?? null, lastAttemptAt: attempted?.started_at ?? null, intervalHours: config?.intervalHours ?? 12 }, Date.parse(now())))
        return execute({ commandId: `scheduled-${randomUUID()}`, action: 'backup', sourceBackupId: null }, maintenance)
      return null
    },
  }
}
