import type { ProjectFormReadDTO } from '~/lib/project/command-contract'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectProblem, ProjectRepositoryProblem } from '~/lib/project/repository'
import {
  ProjectCommandConflictError,
  ProjectLocalDraftOnlyError,
  useProjectCommandStore,
} from '~/stores/project-command'

const context = {
  workspaceId: 'workspace-default',
  actorId: 'actor-default',
  capabilities: ['project:write'],
}

function latestForm(version: string, name = '服务器项目'): ProjectFormReadDTO {
  return {
    draft: { id: 'project-1', name, manager: '张经理', status: '筹备中' },
    attachments: [],
    version,
    updatedAt: '2026-08-15T08:00:00.000Z',
  }
}

describe('project command store', () => {
  const values = new Map<string, string>()
  const repository = {
    context: vi.fn(),
    loadForm: vi.fn(),
    execute: vi.fn(),
  }

  beforeEach(() => {
    values.clear()
    repository.context.mockReset().mockResolvedValue(context)
    repository.loadForm.mockReset()
    repository.execute.mockReset()
    setActivePinia(createPinia())
    vi.stubGlobal('localStorage', {
      get length() { return values.size },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    })
    vi.stubGlobal('useNuxtApp', () => ({
      $repositories: { projectCommands: repository },
    }))
  })

  it('服务端确认后清除本地阶段草稿', async () => {
    repository.execute.mockResolvedValue({
      id: 'opaque-1',
      commandId: 'command-1',
      version: '1',
      updatedAt: '2026-08-15T08:00:00.000Z',
      attachmentIds: [],
    })
    const store = useProjectCommandStore()
    const session = store.createSession()
    await store.hydrate(session, null)

    await expect(store.saveForm(session, { name: '新项目' }, 'draft')).resolves.toMatchObject({
      id: 'opaque-1',
    })
    expect(repository.execute).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-default',
      actorId: 'actor-default',
      baseVersion: null,
    }))
    expect(values.size).toBe(0)
  })

  it('保存并新建重置目标、版本和命令意图，连续两次都创建新项目', async () => {
    repository.execute
      .mockResolvedValueOnce({
        id: 'opaque-1',
        commandId: 'command-1',
        version: '1',
        updatedAt: '2026-08-15T08:00:00.000Z',
        attachmentIds: [],
      })
      .mockResolvedValueOnce({
        id: 'opaque-2',
        commandId: 'command-2',
        version: '1',
        updatedAt: '2026-08-15T08:01:00.000Z',
        attachmentIds: [],
      })
    const store = useProjectCommandStore()
    const session = store.createSession()
    await store.hydrate(session, null)

    await store.saveForm(session, { name: '第一个项目' }, 'save')
    store.startNewProject(session)
    await store.saveForm(session, { name: '第二个项目' }, 'save')

    expect(repository.execute).toHaveBeenCalledTimes(2)
    for (const [request] of repository.execute.mock.calls) {
      expect(request).not.toHaveProperty('id')
      expect(request).toMatchObject({ baseVersion: null })
    }
    expect(repository.execute.mock.calls[0]?.[0].commandId)
      .not
      .toBe(repository.execute.mock.calls[1]?.[0].commandId)
  })

  it('网络失败时只留下可恢复的本地草稿', async () => {
    repository.context.mockRejectedValue(new ProjectRepositoryProblem(
      projectProblem('unavailable', '网络不可用', true),
    ))
    const store = useProjectCommandStore()
    const session = store.createSession()
    await store.hydrate(session, null)

    await expect(store.saveForm(session, { name: '断网项目' }, 'draft'))
      .rejects
      .toBeInstanceOf(ProjectLocalDraftOnlyError)
    expect([...values.values()].join('')).toContain('断网项目')
    expect([...values.values()].join('')).toContain('project-draft-')
    expect(repository.execute).not.toHaveBeenCalled()
  })

  it('编辑表单远端不可达时从同一目标分区恢复本地草稿', async () => {
    repository.loadForm.mockResolvedValueOnce(latestForm('1'))
    repository.context.mockRejectedValueOnce(new ProjectRepositoryProblem(
      projectProblem('unavailable', '网络不可用', true),
    ))
    const firstStore = useProjectCommandStore()
    const session = firstStore.createSession()
    await firstStore.hydrate(session, 'project-1')
    await expect(firstStore.saveForm(session, { id: 'project-1', name: '断网编辑内容' }, 'draft'))
      .rejects
      .toBeInstanceOf(ProjectLocalDraftOnlyError)

    repository.loadForm.mockRejectedValueOnce(new ProjectRepositoryProblem(
      projectProblem('unavailable', '后台不可达', true),
    ))
    setActivePinia(createPinia())
    const restoredStore = useProjectCommandStore()
    const restored = await restoredStore.hydrate(restoredStore.createSession(), 'project-1')

    expect(restored.restoredLocalDraft).toMatchObject({
      targetProjectId: 'project-1',
      baseVersion: '1',
      draft: { id: 'project-1', name: '断网编辑内容' },
    })
    expect(restored.draft).toMatchObject({ id: 'project-1', name: '断网编辑内容' })
  })

  it('冲突后重读最新版本，保留本地内容时显式 rebase 再重试', async () => {
    repository.loadForm
      .mockResolvedValueOnce(latestForm('1'))
      .mockResolvedValueOnce(latestForm('2', '服务器最新项目'))
    repository.execute
      .mockRejectedValueOnce(new ProjectRepositoryProblem(
        projectProblem('conflict', '版本冲突'),
      ))
      .mockResolvedValueOnce({
        id: 'project-1',
        commandId: 'same-command',
        version: '3',
        updatedAt: '2026-08-15T09:00:00.000Z',
        attachmentIds: [],
      })
    const store = useProjectCommandStore()
    const session = store.createSession()
    await store.hydrate(session, 'project-1')

    const first = store.saveForm(session, { id: 'project-1', name: '我的修改' }, 'draft')
    const conflict = await first.catch(cause => cause)
    expect(conflict).toBeInstanceOf(ProjectCommandConflictError)
    expect(conflict.latest).toMatchObject({ version: '2', draft: { name: '服务器最新项目' } })

    store.rebase(session, '2')
    await store.saveForm(session, { id: 'project-1', name: '我的修改' }, 'draft')
    expect(repository.execute).toHaveBeenLastCalledWith(expect.objectContaining({
      baseVersion: '2',
      draft: expect.objectContaining({ name: '我的修改' }),
    }))
  })
})
