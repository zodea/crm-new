import type { ProjectCommandResultDTO } from './command-contract'

export interface ProjectLifecycleCommand {
  id: string
  commandId: string
  workspaceId: string
  actorId: string
  requiredCapability: 'project:write'
  baseVersion: string
  action: 'delete' | 'restore'
}
export interface ProjectLifecycleRead { id: string, name: string, version: string, deletedAt: string | null }
export interface ProjectCommandLookup {
  commandId: string
  fingerprint: string | null
  result: ProjectCommandResultDTO | null
  outcome: 'applied' | 'not-applied'
}
