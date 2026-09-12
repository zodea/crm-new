import type { DataOriginDTO, ProblemDTO } from '../../types/read-model'
import type { QuantityAssignmentBatchDraft, QuantityAssignmentWriteResult } from './assignment'
import type { QuantityBatchCompletionResult } from './batch-completion'
import type { QuantityArchiveAction } from './central-archive'
import type { QuantityCompletionAction } from './central-completion-action'
import type { QuantityStageAction } from './central-stages'
import type { QuantityCompletionWriteResult } from './completion'
import type { QuantityImportAction } from './import-contract'
import type { QuantityRegionNodeDraft, QuantityRegionUnitDraft } from './region'
import type { QuantityTemplateDraft } from './template'

export const QUANTITY_READ_CAPABILITY = 'quantity:read' as const
export const QUANTITY_WRITE_CAPABILITY = 'quantity:write' as const

export interface QuantityContext {
  workspaceId: string
  actorId: string
  capabilities: readonly string[]
}

export interface QuantityReadQuery {
  projectId: string
  origin: DataOriginDTO
  includeDemo: boolean
}

export interface QuantityUnitReadQuery extends QuantityReadQuery {
  unitId: string
}

export interface QuantityBatchReadQuery extends QuantityReadQuery {
  trade: string
  unitIds: string[]
}

export interface QuantityReadResult<T> {
  data: T
  dataOrigin: DataOriginDTO
  sourceVersion: string
  asOf: string
  capabilities: readonly string[]
}

export type QuantityRegionAction = { kind: 'create-building', draft: QuantityRegionNodeDraft }
  | { kind: 'create-floor', buildingId: string, draft: QuantityRegionNodeDraft }
  | { kind: 'create-unit', floorId: string, draft: QuantityRegionUnitDraft }

export type QuantityTemplateAction = { kind: 'save-template', draft: QuantityTemplateDraft }
  | { kind: 'delete-template', templateId: string, allowArchivedEdit: boolean }
  | { kind: 'undo-template', logIds: string[], allowArchivedEdit: boolean }

export interface QuantityAssignmentAction { kind: 'save-assignments', draft: QuantityAssignmentBatchDraft }

export interface QuantityCommand {
  workspaceId: string
  actorId: string
  requiredCapability: typeof QUANTITY_WRITE_CAPABILITY
  commandId: string
  baseVersion: string
  origin: DataOriginDTO
  projectId: string
  action: QuantityRegionAction | QuantityTemplateAction | QuantityAssignmentAction | QuantityCompletionAction | QuantityStageAction | QuantityArchiveAction | QuantityImportAction
}

export interface QuantityCommandResult {
  commandId: string
  id: string
  logIds: string[]
  sourceVersion: string
  assignments?: QuantityAssignmentWriteResult
  completion?: QuantityCompletionWriteResult
  batch?: QuantityBatchCompletionResult
}

export class QuantityRepositoryProblem extends Error {
  constructor(readonly problem: ProblemDTO, options?: ErrorOptions) {
    super(problem.message, options)
    this.name = 'QuantityRepositoryProblem'
  }
}

export function quantityProblem(code: ProblemDTO['code'], message: string): QuantityRepositoryProblem {
  return new QuantityRepositoryProblem({ code, message, retryable: code === 'unavailable', fieldErrors: {}, traceId: null })
}
