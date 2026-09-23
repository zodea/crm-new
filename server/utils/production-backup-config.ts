import { isAbsolute, resolve, sep } from 'node:path'
import process from 'node:process'

export interface ProductionBackupConfig {
  stagingDirectory: string
  primaryDirectory: string
  offlineDirectory: string
  restoreDirectory: string
  intervalHours: number
  dailyCopies: number
  monthlyCopies: number
}
export function getProductionBackupConfig(sourceDirectory: string): ProductionBackupConfig | null {
  const paths = [process.env.CRM_BACKUP_STAGING_DIRECTORY, process.env.CRM_BACKUP_DIRECTORY, process.env.CRM_BACKUP_OFFLINE_DIRECTORY, process.env.CRM_BACKUP_RESTORE_DIRECTORY]
  if (paths.some(path => !path))
    return null
  if (paths.some(path => !isAbsolute(path!)))
    throw new Error('备份配置需要已存在的绝对目录。')
  const normalize = (path: string) => {
    const value = resolve(path).replace(/[\\/]+$/, '')
    return process.platform === 'win32' ? value.toLowerCase() : value
  }
  const roots = [normalize(sourceDirectory), ...paths.map(path => normalize(path!))]
  if (roots.some((a, index) => roots.some((b, other) => index !== other && (a === b || a.startsWith(`${b}${sep}`)))))
    throw new Error('活动数据、临时副本、主备份、离线副本与隔离恢复目录必须彼此独立，不能相互包含。')
  if (paths[0]!.startsWith('\\\\') || paths[3]!.startsWith('\\\\'))
    throw new Error('临时副本与隔离恢复必须使用本机目录。')
  function integer(value: string | undefined, fallback: number, maximum: number) {
    if (!value)
      return fallback
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > maximum)
      throw new Error('备份周期或保留份数配置无效。')
    return Number(value)
  }
  return {
    stagingDirectory: resolve(paths[0]!),
    primaryDirectory: resolve(paths[1]!),
    offlineDirectory: resolve(paths[2]!),
    restoreDirectory: resolve(paths[3]!),
    intervalHours: integer(process.env.CRM_BACKUP_INTERVAL_HOURS, 12, 24),
    dailyCopies: integer(process.env.CRM_BACKUP_DAILY_COPIES, 30, 3650),
    monthlyCopies: integer(process.env.CRM_BACKUP_MONTHLY_COPIES, 12, 120),
  }
}
