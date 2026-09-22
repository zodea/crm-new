import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { f2FormDefaults } from '~/lib/contract/page'
import { materialContractProblem, MaterialContractRepositoryProblem } from '~/lib/material-contract/repository'
import {
  MaterialContractCommandConflictError,
  useMaterialContractCommandStore,
} from '~/stores/material-contract-command'

const draft = {
  ...f2FormDefaults('material'),
  id: 'contract-1',
  name: '我的合同内容',
}
const initial = {
  draft: { ...draft, name: '初始合同' },
  attachments: [],
  version: '1',
  updatedAt: '2026-08-24T00:00:00.000Z',
}
const latest = {
  draft: { ...draft, name: '服务器最新版' },
  attachments: [],
  version: '2',
  updatedAt: '2026-08-24T01:00:00.000Z',
}

describe('材料采购合同冲突恢复', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('保留我的内容后采用服务器新版本再次提交', async () => {
    const repository = {
      context: vi.fn().mockResolvedValue({
        workspaceId: 'workspace-default',
        actorId: 'actor-default',
        capabilities: ['material-contract:write'],
        projects: [],
        suppliers: [],
      }),
      loadForm: vi.fn()
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(latest),
      execute: vi.fn()
        .mockRejectedValueOnce(new MaterialContractRepositoryProblem(materialContractProblem('conflict', '版本冲突')))
        .mockResolvedValueOnce({
          id: 'contract-1',
          commandId: 'retry-command',
          version: '3',
          updatedAt: '2026-08-24T02:00:00.000Z',
          attachmentIds: [],
        }),
    }
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { materialContractCommands: repository } }))
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValueOnce('stale-command').mockReturnValueOnce('retry-command') })

    const store = useMaterialContractCommandStore()
    const session = store.createSession()
    await store.hydrate(session, 'contract-1')
    let conflict: MaterialContractCommandConflictError | null = null
    try {
      await store.saveForm(session, draft, 'save')
    }
    catch (cause) {
      if (cause instanceof MaterialContractCommandConflictError)
        conflict = cause
      else
        throw cause
    }
    expect(conflict?.latest.version).toBe('2')
    store.adoptConflictVersion(session, conflict!.latest)
    await store.saveForm(session, draft, 'save')

    expect(repository.execute).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'contract-1',
      baseVersion: '2',
      commandId: 'retry-command',
      draft: expect.objectContaining({ name: '我的合同内容' }),
    }))
  })
})
