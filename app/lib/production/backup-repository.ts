import type { ProductionBackupCommand, ProductionBackupRun, ProductionBackupStatus } from './backup-contract'

function invalid(): never {
  throw new Error('备份结果不完整，请保留原操作编号重新核对。')
}
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const identity = (value: unknown) => typeof value === 'string' && /^[a-z0-9][\w-]{2,79}$/i.test(value)
export function decodeBackupRun(value: unknown): ProductionBackupRun {
  const row = value as ProductionBackupRun | null
  if (!row || !identity(row.commandId) || !['backup', 'copy-offline', 'verify-restore'].includes(row.action)
    || !['running', 'succeeded', 'failed'].includes(row.state) || !date(row.startedAt)
    || (row.completedAt !== null && !date(row.completedAt)) || (row.capturedAt !== null && !date(row.capturedAt))
    || (row.packageId !== null && !identity(row.packageId)) || (row.message !== null && typeof row.message !== 'string')
    || (row.state === 'succeeded' && (!row.completedAt || !row.capturedAt || !row.packageId))
    || (row.state === 'failed' && (!row.completedAt || !row.message))) {
    return invalid()
  }
  return row
}
export function decodeBackupStatus(value: unknown): ProductionBackupStatus {
  const row = value as ProductionBackupStatus | null
  if (!row || !identity(row.workspaceId) || !identity(row.ownerId) || typeof row.configured !== 'boolean' || typeof row.running !== 'boolean'
    || !['unconfigured', 'never', 'clock-invalid', 'expired', 'failed', 'protected'].includes(row.protection)
    || !Number.isInteger(row.intervalHours) || row.intervalHours < 1 || row.intervalHours > 24 || row.releaseState !== 'awaiting-final-acceptance'
    || !Array.isArray(row.recent) || row.recent.length > 10) {
    return invalid()
  }
  if (row.latest !== null && (decodeBackupRun(row.latest).state !== 'succeeded' || row.latest.action !== 'backup'))
    return invalid()
  if (row.offline !== null && (decodeBackupRun(row.offline).state !== 'succeeded' || row.offline.action !== 'copy-offline'))
    return invalid()
  if (row.baseline !== null && (!identity(row.baseline.packageId) || !date(row.baseline.capturedAt) || !date(row.baseline.restoredAt) || !Number.isSafeInteger(row.baseline.schemaVersion) || row.baseline.schemaVersion < 1 || typeof row.baseline.current !== 'boolean'))
    return invalid()
  row.recent.forEach(decodeBackupRun)
  return row
}
export function createProductionBackupRepository(fetcher: (url: string, options?: { method: 'POST', body: ProductionBackupCommand }) => Promise<unknown>) {
  return {
    status: async () => decodeBackupStatus(await fetcher('/api/production/backup/status')),
    execute: async (command: ProductionBackupCommand) => {
      const run = decodeBackupRun(await fetcher('/api/commands/production-backups', { method: 'POST', body: command }))
      if (run.commandId !== command.commandId || run.action !== command.action || (command.sourceBackupId !== null && run.packageId !== command.sourceBackupId))
        return invalid()
      return run
    },
  }
}
