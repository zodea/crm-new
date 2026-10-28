import type { DataOriginDTO } from '../../types/read-model'
import type { CommandRecoveryDescriptor } from '../forms/command-recovery'
import type { AddScheduleTaskDraft, CreateScheduleGroupDraft, SaveScheduleTaskPlanDraft, ScheduleProvisionalScopePreview, UpdateScheduleFloorPlanPatch, UpdateScheduleTaskPatch } from './engine'
import type { ScheduleHistory } from './history'
import type { ScheduleBuildingCoverage, ScheduleBuildingOption, ScheduleCatalogProject, ScheduleContractOption, ScheduleProjectView } from './read-model'
import { projectProblem, ProjectRepositoryProblem } from '../project/repository'

export const SCHEDULE_WRITE_CAPABILITY = 'schedule:write' as const
export interface ScheduleReadQuery { projectId: string, origin: DataOriginDTO, includeDemo: boolean, today?: string }
export interface ScheduleReadContext {
  workspaceId: string
  actorId: string
  origin: DataOriginDTO
  capabilities: readonly string[]
  sourceVersion: string
}
export interface ScheduleRead extends ScheduleReadContext {
  contractSourceState?: 'available' | 'unavailable'
  contractSourceMessage?: string
  history: ScheduleHistory
  snapshot: ScheduleProjectView
  contracts: ScheduleContractOption[]
  buildings: ScheduleBuildingOption[]
  buildingCoverage: ScheduleBuildingCoverage[]
}
export interface ScheduleCatalog extends ScheduleReadContext { projects: (ScheduleCatalogProject & { origin: DataOriginDTO })[] }
export type ScheduleAction = { kind: 'create-group', draft: CreateScheduleGroupDraft }
  | { kind: 'update-task', taskId: string, patch: UpdateScheduleTaskPatch }
  | { kind: 'update-floors', taskId: string, patches: UpdateScheduleFloorPlanPatch[] }
  | { kind: 'update-dependency', successorId: string, predecessorId: string, lagDays: number }
  | { kind: 'save-task-plan', taskId: string, draft: SaveScheduleTaskPlanDraft }
  | { kind: 'reschedule-task', taskId: string, patch: UpdateScheduleTaskPatch, dependencyIdsToDisable: string[] }
  | { kind: 'remove-dependency' | 'restore-dependency', dependencyId: string }
  | { kind: 'set-baseline' }
  | { kind: 'add-task', groupId: string, draft: AddScheduleTaskDraft }
  | { kind: 'remove-task', taskId: string }
  | { kind: 'undo', logIds: string[] }
  | { kind: 'bind-contract', groupId: string, contractId: string }
export interface ScheduleCommand {
  commandId: string
  workspaceId: string
  actorId: string
  origin: DataOriginDTO
  requiredCapability: typeof SCHEDULE_WRITE_CAPABILITY
  projectId: string
  sourceVersion: string
  action: ScheduleAction
}
export interface ScheduleCommandResult { commandId: string, projectId: string, sourceVersion: string, value: unknown }
export interface SchedulePending { descriptor: CommandRecoveryDescriptor, command: ScheduleCommand | null, state: 'sending' | 'applied' | 'unknown' }
export interface ScheduleScopeRead extends ScheduleReadContext { preview: ScheduleProvisionalScopePreview }
export function scheduleProblem(code: Parameters<typeof projectProblem>[0], message: string) {
  return new ProjectRepositoryProblem(projectProblem(code, message))
}
