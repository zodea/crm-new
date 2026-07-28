import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { applyFileRefChanges } from '~/lib/forms/file-refs'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb

beforeEach(async () => {
  db = await createMemoryDb()
  await runMigrations(db)
  await db.execute(`
    INSERT INTO projects (id, name, code)
    VALUES ('project-files', '文件测试项目', 'FILE-001')
  `)
  await db.execute(`
    INSERT INTO phase_tasks (
      id, project_id, phase_index, task_index, title, status
    )
    VALUES ('phase-files', 'project-files', 1, 0, '施工组织设计方案', 'pending')
  `)
})

afterEach(() => db.close())

describe('phase task file references', () => {
  it('persists browser payload beside the canonical file reference and keeps it for undo', async () => {
    const [fileId] = await applyFileRefChanges(db, 'phase_task', 'phase-files', {
      add: [{
        fileName: '施工组织设计.pdf',
        fileSize: 7,
        mimeType: 'application/pdf',
        category: '施工准备',
        uploader: '资料员',
        payloadBase64: 'cGF5bG9hZA==',
      }],
    })

    const [file] = await db.select<Record<string, unknown>>(
      'SELECT * FROM file_refs WHERE id = ?',
      [fileId],
    )
    const [payload] = await db.select<Record<string, unknown>>(
      'SELECT * FROM file_payloads WHERE file_ref_id = ?',
      [fileId],
    )
    expect(file).toMatchObject({
      owner_type: 'phase_task',
      owner_id: 'phase-files',
      file_name: '施工组织设计.pdf',
      category: '施工准备',
      uploader: '资料员',
      deleted_at: null,
    })
    expect(payload).toMatchObject({
      encoding: 'base64',
      content: 'cGF5bG9hZA==',
    })

    await applyFileRefChanges(db, 'phase_task', 'phase-files', {
      removeIds: [fileId],
    })
    expect((await db.select<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM file_refs WHERE id = ?',
      [fileId],
    ))[0]?.deleted_at).not.toBeNull()
    expect((await db.select(
      'SELECT file_ref_id FROM file_payloads WHERE file_ref_id = ?',
      [fileId],
    ))).toHaveLength(1)

    await applyFileRefChanges(db, 'phase_task', 'phase-files', {
      restoreIds: [fileId],
    })
    expect((await db.select<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM file_refs WHERE id = ?',
      [fileId],
    ))[0]?.deleted_at).toBeNull()
  })

  it('rejects deleting a file through a different task owner', async () => {
    const [fileId] = await applyFileRefChanges(db, 'phase_task', 'phase-files', {
      add: [{ fileName: '验收记录.pdf' }],
    })

    await expect(applyFileRefChanges(db, 'phase_task', 'other-task', {
      removeIds: [fileId],
    })).rejects.toThrow('附件不存在或不属于当前记录')
  })
})
