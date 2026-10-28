import type { BoqOriginalInput } from './production-contract'

export interface BoqSourceImportCommand {
  workspaceId: string
  actorId: string
  commandId: string
  source: { sha256: string, payloadBase64: string }
  heads: Array<{ id: string, version: string }>
  originals: Array<{ fileId: string, original: BoqOriginalInput }>
}
export interface BoqSourceImportResult {
  workspaceId: string
  actorId: string
  commandId: string
  importId: string
  sourceSha256: string
  fileIds: string[]
  lineIds: string[]
  changeIds: string[]
  priceIds: string[]
  restored?: boolean
}
export interface BoqSourceImportPreview {
  workspaceId: string
  actorId: string
  sourceSha256: string
  schemaVersion: number
  heads: Array<{ id: string, name: string, projectId: string, version: string }>
  counts: { files: number, lines: number, changes: number, prices: number }
  originals: Array<{ fileId: string, fileName: string, filePath: string, required: boolean, bodyState: 'embedded' | 'metadata-only' | 'path-original-required' }>
}
