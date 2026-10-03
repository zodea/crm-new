import type { ProductionBackupCommand, ProductionBackupStatus } from './backup-contract'

export function backupPendingKey(scope: Pick<ProductionBackupStatus, 'workspaceId' | 'ownerId'>) {
  return `crm:backup-command:v1:${encodeURIComponent(scope.workspaceId)}:${encodeURIComponent(scope.ownerId)}`
}
const invalid = () => new Error('无法可靠保存原备份操作，请恢复浏览器存储后重新核对。')
export function readBackupPending(key: string): ProductionBackupCommand | null {
  try {
    const text = window.sessionStorage.getItem(key)
    if (text === null)
      return null
    const value = JSON.parse(text)
    if (!value || Object.keys(value).sort().join(',') !== 'action,commandId,sourceBackupId' || typeof value.commandId !== 'string' || !/^[a-z0-9][\w-]{2,79}$/i.test(value.commandId)
      || !['backup', 'copy-offline', 'verify-restore'].includes(value.action)
      || (value.action === 'backup' ? value.sourceBackupId !== null : typeof value.sourceBackupId !== 'string' || !/^backup-[\da-f-]{36}$/.test(value.sourceBackupId))) {
      throw invalid()
    }
    return value
  }
  catch { throw invalid() }
}
export function saveBackupPending(key: string, command: ProductionBackupCommand) {
  if (readBackupPending(key))
    throw new Error('请先核对上次备份操作。')
  try {
    window.sessionStorage.setItem(key, JSON.stringify(command))
    if (JSON.stringify(readBackupPending(key)) !== JSON.stringify(command))
      throw invalid()
  }
  catch { throw invalid() }
}
export function clearBackupPending(key: string, commandId: string) {
  if (readBackupPending(key)?.commandId !== commandId)
    throw invalid()
  try {
    window.sessionStorage.removeItem(key)
    if (readBackupPending(key) !== null)
      throw invalid()
  }
  catch { throw invalid() }
}
