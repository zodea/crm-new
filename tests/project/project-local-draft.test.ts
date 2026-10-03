import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearProjectLocalDraft,
  loadProjectLocalDraft,
  PROJECT_LOCAL_DRAFT_SCHEMA_VERSION,
  saveProjectLocalDraft,
} from '../../app/lib/project/local-draft'

describe('project local draft', () => {
  const values = new Map<string, string>()
  beforeEach(() => {
    values.clear()
    vi.stubGlobal('localStorage', {
      get length() { return values.size },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    })
  })

  it('以独立 draftId 保留失败命令，不伪装成正式项目 ID', () => {
    const saved = saveProjectLocalDraft({
      targetProjectId: null,
      commandId: 'command-offline-1',
      baseVersion: null,
      action: 'draft',
      draft: { name: '断网草稿' },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    })

    expect(saved.schemaVersion).toBe(PROJECT_LOCAL_DRAFT_SCHEMA_VERSION)
    expect(saved.draftId).toMatch(/^project-draft-/)
    expect(saved.draftId).not.toBe(saved.targetProjectId)
    expect(loadProjectLocalDraft(null)).toEqual(saved)

    clearProjectLocalDraft(saved.draftId)
    expect(loadProjectLocalDraft(null)).toBeNull()
  })

  const valid = {
    schemaVersion: PROJECT_LOCAL_DRAFT_SCHEMA_VERSION,
    draftId: 'project-draft-valid',
    targetProjectId: 'project-1',
    commandId: 'command-valid',
    baseVersion: '3',
    action: 'save',
    draft: { id: 'project-1', name: '可恢复项目', contractAmount: 100 },
    attachments: {
      add: [{ fileName: '合同.pdf', fileSize: 128, mimeType: 'application/pdf' }],
      removeIds: ['attachment-old'],
      restoreIds: [],
    },
    updatedAt: '2026-08-15T08:00:00.000Z',
  }

  it.each(([
    '{not-json',
    JSON.stringify({ ...valid, schemaVersion: 99 }),
    JSON.stringify({ ...valid, targetProjectId: 'project-2' }),
    JSON.stringify({ ...valid, action: 'publish' }),
    JSON.stringify({ ...valid, draft: { id: 'project-1', contractAmount: '100' } }),
    JSON.stringify({ ...valid, draft: { id: 'project-1', startDate: 'garbage' } }),
    JSON.stringify({ ...valid, draft: { id: 'project-1', contractAmount: -1 } }),
    JSON.stringify({ ...valid, attachments: { add: [{ fileName: 42 }] } }),
    JSON.stringify({ ...valid, updatedAt: 'not-a-date' }),
  ]).map(input => ({ input })))('只解码当前完整版本，并安全忽略损坏、错分区和未知版本数据', ({ input: damaged }) => {
    const key = 'ruihang:project-local-draft:project-1'

    values.set(key, JSON.stringify(valid))
    expect(loadProjectLocalDraft('project-1')).toEqual(valid)

    values.set(key, damaged)
    expect(loadProjectLocalDraft('project-1')).toBeNull()
  })
})
