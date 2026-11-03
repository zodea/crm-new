import type { ConstructionMainSelection } from '../construction-scope/contract'
import type { ContractLineItemDraft, ProjectContractFormDraft } from '../contract/forms'

export interface MaterialExcelFile { fileName: string, fileSize: number, payloadBase64: string }
export interface MaterialExcelReference { id: string, name: string, version: string }
export interface MaterialExcelPreviewRow {
  key: string
  rowNumber: number
  draft: ProjectContractFormDraft
  projectName: string
  supplierName: string
  constructionName: string
  signatoryName: string
  lineItems: ContractLineItemDraft[]
  lineCount: number
  fingerprint: string
  candidates: Array<{ id: string, version: string, name: string, no: string, fields: Record<string, unknown>, lineCount: number, attachmentCount: number }>
  projects: MaterialExcelReference[]
  suppliers: MaterialExcelReference[]
  signatories: MaterialExcelReference[]
  mains: Array<ConstructionMainSelection & { name: string, no: string }>
}
export interface MaterialExcelDecision {
  key: string
  fingerprint: string
  kind: 'create' | 'replace' | 'skip'
  id?: string
  version?: string
  project?: MaterialExcelReference
  supplier?: MaterialExcelReference
  signatory?: MaterialExcelReference
  main?: ConstructionMainSelection
}
export interface MaterialExcelBatchRequest {
  workspaceId: string
  actorId: string
  file: MaterialExcelFile
  decisions: MaterialExcelDecision[]
}
