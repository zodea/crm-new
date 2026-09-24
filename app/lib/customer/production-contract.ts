import type { CustomerCommandResultDTO } from './command-contract'

export interface CustomerLifecycleCommand {
  id: string
  commandId: string
  workspaceId: string
  actorId: string
  requiredCapability: 'customer:write'
  baseVersion: string
  action: 'delete' | 'restore'
}
export interface CustomerLifecycleRead {
  id: string
  name: string
  version: string
  deletedAt: string | null
}
export interface CustomerCommandLookup {
  commandId: string
  fingerprint: string | null
  result: CustomerCommandResultDTO | null
  outcome: 'applied' | 'not-applied'
}
