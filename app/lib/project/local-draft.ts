import type { ProjectCommandRequestDTO } from './command-contract'
import {
  decodeProjectAttachmentChanges,
  decodeProjectFormDraft,
} from './command-validation'

export const PROJECT_LOCAL_DRAFT_SCHEMA_VERSION = 1 as const

export interface ProjectLocalDraft extends Omit<ProjectCommandRequestDTO, 'id' | 'workspaceId' | 'actorId' | 'requiredCapability'> {
  schemaVersion: typeof PROJECT_LOCAL_DRAFT_SCHEMA_VERSION
  draftId: string
  targetProjectId: string | null
  updatedAt: string
}

type ProjectLocalDraftInput = Omit<ProjectLocalDraft, 'schemaVersion' | 'draftId' | 'updatedAt'>

const STORAGE_PREFIX = 'ruihang:project-local-draft:'
const LOCAL_DRAFT_FIELDS = new Set([
  'schemaVersion',
  'draftId',
  'targetProjectId',
  'commandId',
  'baseVersion',
  'action',
  'draft',
  'attachments',
  'updatedAt',
])
const ACTIONS = new Set<ProjectLocalDraft['action']>(['draft', 'save', 'submit'])

function storageKey(targetProjectId: string | null): string {
  return `${STORAGE_PREFIX}${targetProjectId ?? 'new'}`
}

function newDraftId(): string {
  return `project-draft-${crypto.randomUUID()}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every(key => allowed.has(key))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string')
    return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function parseDraft(value: string | null): ProjectLocalDraft | null {
  if (!value)
    return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed)
      || !hasOnlyKeys(parsed, LOCAL_DRAFT_FIELDS)
      || parsed.schemaVersion !== PROJECT_LOCAL_DRAFT_SCHEMA_VERSION
      || !isNonEmptyString(parsed.draftId)
      || !parsed.draftId.startsWith('project-draft-')
      || !isNonEmptyString(parsed.commandId)
      || !isIsoTimestamp(parsed.updatedAt)) {
      return null
    }

    const { action, baseVersion, targetProjectId } = parsed
    if (!(targetProjectId === null || isNonEmptyString(targetProjectId))
      || !(baseVersion === null || isNonEmptyString(baseVersion))
      || typeof action !== 'string'
      || !ACTIONS.has(action as ProjectLocalDraft['action'])) {
      return null
    }
    const draft = decodeProjectFormDraft(parsed.draft)
    if (targetProjectId === null ? draft.id !== undefined : draft.id !== targetProjectId)
      return null
    return {
      schemaVersion: PROJECT_LOCAL_DRAFT_SCHEMA_VERSION,
      draftId: parsed.draftId,
      targetProjectId,
      commandId: parsed.commandId,
      baseVersion,
      action: action as ProjectLocalDraft['action'],
      draft,
      attachments: decodeProjectAttachmentChanges(parsed.attachments),
      updatedAt: parsed.updatedAt,
    }
  }
  catch {
    return null
  }
}

export function loadProjectLocalDraft(targetProjectId: string | null): ProjectLocalDraft | null {
  if (typeof localStorage === 'undefined')
    return null
  const parsed = parseDraft(localStorage.getItem(storageKey(targetProjectId)))
  return parsed?.targetProjectId === targetProjectId ? parsed : null
}

export function saveProjectLocalDraft(input: ProjectLocalDraftInput): ProjectLocalDraft {
  const existing = loadProjectLocalDraft(input.targetProjectId)
  const value: ProjectLocalDraft = {
    ...input,
    schemaVersion: PROJECT_LOCAL_DRAFT_SCHEMA_VERSION,
    draftId: existing?.draftId ?? newDraftId(),
    updatedAt: new Date().toISOString(),
  }
  localStorage.setItem(storageKey(input.targetProjectId), JSON.stringify(value))
  return value
}

export function clearProjectLocalDraft(draftId: string): void {
  if (typeof localStorage === 'undefined')
    return
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)
    if (!key?.startsWith(STORAGE_PREFIX))
      continue
    if (parseDraft(localStorage.getItem(key))?.draftId === draftId)
      localStorage.removeItem(key)
  }
}
