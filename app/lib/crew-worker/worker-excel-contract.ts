import type { WorkerFormDraft } from '../master-data/forms'

export type WorkerExcelDraft = Omit<WorkerFormDraft, 'id' | 'status' | 'crewId' | 'currentProjectId' | 'familyGroupId'> & { crewName?: string, projectName?: string }
export interface WorkerExcelReference { id: string, name: string, version: string }
export interface WorkerExcelPreview {
  fingerprint: string
  candidates: Array<{ id: string, name: string, version: string, matchedBy: Array<'name' | 'idCard' | 'phone'>, fields: Record<string, unknown> }>
  crews: WorkerExcelReference[]
  projects: WorkerExcelReference[]
}
export interface WorkerExcelPreviewBatch { workspaceId: string, actorId: string, capabilities: string[], previews: WorkerExcelPreview[] }
export interface WorkerExcelDecision {
  kind: 'create' | 'replace'
  fingerprint: string
  id?: string
  version?: string
  crew?: { id: string, version: string }
  project?: { id: string, version: string }
}
export interface WorkerExcelImportCommand {
  workspaceId: string
  actorId: string
  requiredCapability: 'worker:write'
  commandId: string
  draft: WorkerExcelDraft
  decision: WorkerExcelDecision
}
