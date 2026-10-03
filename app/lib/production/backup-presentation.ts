import type { ProductionBackupStatus } from './backup-contract'

export const backupProtectionLabels: Record<ProductionBackupStatus['protection'], string> = {
  'unconfigured': '备份尚未配置',
  'never': '尚无成功备份',
  'clock-invalid': '备份时间需要核对',
  'expired': '备份已超过 24 小时',
  'failed': '最近备份失败',
  'protected': '主备份在 24 小时内',
}
export const backupActionLabels = { 'backup': '主备份', 'copy-offline': '离线副本', 'verify-restore': '隔离恢复验证' }
export function backupTime(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(new Date(value)) : '尚未完成'
}
