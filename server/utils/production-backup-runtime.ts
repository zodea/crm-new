import { getProductionBackupConfig } from './production-backup-config'
import { backupInvalid } from './production-backup-manifest'
import { createProductionBackupService } from './production-backup-service'
import { getProductionRuntimeConfig } from './production-config'
import { productionRuntime } from './production-runtime'

let runtime: { key: string, service: ReturnType<typeof createProductionBackupService> } | null = null
export function productionBackupRuntime() {
  const config = getProductionRuntimeConfig()
  const main = productionRuntime()
  if (!config || !main)
    return null
  const backupConfig = getProductionBackupConfig(config.directory)
  const key = JSON.stringify([main.key, backupConfig])
  if (runtime && runtime.key !== key)
    backupInvalid('备份配置已变化，请按维护流程重启服务后再操作。')
  runtime ??= { key, service: createProductionBackupService(main.storage, backupConfig) }
  return runtime.service
}
