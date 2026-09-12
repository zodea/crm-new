import type { DataOriginDTO } from '../../types/read-model'
import type { ScheduleProcessLibraryDetail, ScheduleProcessLibraryTask, ScheduleProcessLibraryVersionDraft } from './process-library'
import { projectProblem, ProjectRepositoryProblem } from '../project/repository'

export const PROCESS_LIBRARY_READ_CAPABILITY = 'process-library:read' as const
export const PROCESS_LIBRARY_WRITE_CAPABILITY = 'process-library:write' as const

export interface ProcessLibraryTask extends ScheduleProcessLibraryTask {
  legacyId: string | null
  createdAt: string | null
  updatedAt: string | null
  deletedAt: string | null
}

/** 每个 id 代表一个不可变版本；使用数量在中央 WBS 接管前保持未知。 */
export interface ProcessLibraryVersion extends Omit<ScheduleProcessLibraryDetail, 'tasks' | 'usageCount'> {
  tasks: ProcessLibraryTask[]
  usageCount: number | null
  dataOrigin: DataOriginDTO
  sourceVersion: string
  sourceVersionId: string | null
  sortOrder: number
  createdAt: string | null
  createdBy: string | null
  updatedAt: string | null
  deletedAt: string | null
  migrationBatchId: string | null
  legacyId: string | null
}

export type ProcessLibrarySummary = Omit<ProcessLibraryVersion, 'tasks'>

export interface ProcessLibraryCatalog {
  /** 仅公开系列的编号基准；包含已删除版本，不包含其正文。 */
  seriesVersions: Record<string, number>
  origin: DataOriginDTO
  workspaceId: string
  actorId: string
  capabilities: readonly string[]
  sourceVersion: string
  libraries: ProcessLibrarySummary[]
}

export interface ProcessLibraryCreateCommand {
  action: 'create-version'
  commandId: string
  workspaceId: string
  actorId: string
  origin: DataOriginDTO
  requiredCapability: typeof PROCESS_LIBRARY_WRITE_CAPABILITY
  /** 本次读到的同编码最高版本；不是复制来源必须为最新版的限制。 */
  baseVersion: number
  sourceVersion: string | null
  draft: ScheduleProcessLibraryVersionDraft
}

export interface ProcessLibraryCommandResult {
  commandId: string
  id: string
  version: number
  sourceVersion: string
}

export function processLibraryProblem(code: Parameters<typeof projectProblem>[0], message: string): ProjectRepositoryProblem {
  return new ProjectRepositoryProblem(projectProblem(code, message))
}
