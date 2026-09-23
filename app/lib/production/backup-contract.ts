export type ProductionBackupAction = 'backup' | 'copy-offline' | 'verify-restore'
export interface ProductionBackupCommand { commandId: string, action: ProductionBackupAction, sourceBackupId: string | null }
export interface ProductionBackupRun {
  commandId: string
  action: ProductionBackupAction
  state: 'running' | 'succeeded' | 'failed'
  startedAt: string
  completedAt: string | null
  capturedAt: string | null
  packageId: string | null
  message: string | null
}
export interface ProductionBackupStatus {
  workspaceId: string
  ownerId: string
  configured: boolean
  protection: 'unconfigured' | 'never' | 'clock-invalid' | 'expired' | 'failed' | 'protected'
  intervalHours: number
  latest: ProductionBackupRun | null
  offline: ProductionBackupRun | null
  baseline: { packageId: string, capturedAt: string, restoredAt: string, schemaVersion: number, current: boolean } | null
  running: boolean
  recent: ProductionBackupRun[]
  releaseState: 'awaiting-final-acceptance'
}
