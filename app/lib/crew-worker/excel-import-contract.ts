import type { CrewFormDraft } from '../master-data/forms'

export type CrewExcelDraft = Omit<CrewFormDraft, 'id' | 'status'>
export interface CrewExcelPreview {
  fingerprint: string
  candidates: Array<{ id: string, version: string, name: string, fields: CrewExcelDraft }>
}
export interface CrewExcelPreviewBatch {
  workspaceId: string
  actorId: string
  capabilities: string[]
  previews: CrewExcelPreview[]
}
export interface CrewExcelDecision {
  kind: 'create' | 'replace'
  fingerprint: string
  id?: string
  version?: string
}
export interface CrewExcelImportCommand {
  workspaceId: string
  actorId: string
  requiredCapability: 'crew:write'
  commandId: string
  draft: CrewExcelDraft
  decision: CrewExcelDecision
}
