import type { DataOriginDTO } from '~/types/read-model'

export const TAB_TARGET_VERSION = 1

/** 只保存视图身份；实体资料与权限必须在恢复时重新读取。 */
export interface TabDescriptor {
  key: string
  title: string
  fullPath: string
  origin: DataOriginDTO | null
  targetVersion: number
  sourceVersion: string | null
  updatedAt: number
  closable: boolean
}

export interface RestorableTabPath {
  fullPath: string
  origin: DataOriginDTO | null
}

export type TabRestoreProblemState = 'not-found' | 'mismatch' | 'forbidden' | 'not-connected' | 'stale' | 'error'

export type TabRestoreResult
  = { state: 'resolved', fullPath: string, title: string, sourceVersion: string | null }
    | { state: TabRestoreProblemState, message: string }

export type TabRestoreValidator = (descriptor: TabDescriptor, signal?: AbortSignal) => Promise<TabRestoreResult>
