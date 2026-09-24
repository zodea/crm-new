import type { ProjectCommandRequestDTO } from '../../app/lib/project/command-contract'
import type { BusinessSession } from '../../server/utils/business-session'
import { describe, expect, it } from 'vitest'
import { parseProjectCommandRequest } from '../../server/utils/project-command-request'
import { createProjectCommandTestInstance } from '../../server/utils/project-command-test-instance'
import { createProjectReadTestInstance } from '../../server/utils/project-read-test-instance'

const SESSION: BusinessSession = {
  workspaceId: 'workspace-default',
  actorId: 'actor-default',
  capabilities: ['project:list:read', 'project:write'],
}

function createRequest(commandId: string) {
  return {
    workspaceId: SESSION.workspaceId,
    actorId: SESSION.actorId,
    requiredCapability: 'project:write' as const,
    commandId,
    baseVersion: null,
    action: 'draft' as const,
    draft: {
      name: '中央命令项目',
      manager: '张经理',
      status: '筹备中',
    },
    attachments: { add: [], removeIds: [], restoreIds: [] },
  }
}

describe('project command test instance', () => {
  it('由服务端分配不透明 ID 和版本，重复 commandId 只返回同一结果', async () => {
    let idSequence = 0
    const instance = createProjectCommandTestInstance({
      createId: () => `opaque-${++idSequence}`,
      now: () => '2026-08-15T08:00:00.000Z',
    })

    const first = await instance.execute(createRequest('command-create-1'), SESSION, 'browser-a')
    const duplicate = await instance.execute(createRequest('command-create-1'), SESSION, 'browser-a')

    expect(first).toEqual(duplicate)
    expect(first).toMatchObject({
      id: 'opaque-1',
      version: '1',
      commandId: 'command-create-1',
      updatedAt: '2026-08-15T08:00:00.000Z',
    })
    expect(instance.rows('browser-a')).toHaveLength(1)
  })

  it('鉴权后优先返回 commandId 的首次成功结果', async () => {
    const instance = createProjectCommandTestInstance({
      createId: () => 'opaque-replay-1',
      now: () => '2026-08-15T08:00:00.000Z',
    })
    const first = await instance.execute(
      createRequest('command-replay-variant'),
      SESSION,
      'browser-a',
    )

    await expect(instance.execute({
      ...createRequest('command-replay-variant'),
      action: 'save',
      draft: { name: '' },
    }, SESSION, 'browser-a')).resolves.toEqual(first)
    await expect(instance.execute({
      ...createRequest('command-replay-variant'),
      actorId: 'actor-spoofed',
    }, SESSION, 'browser-a')).rejects.toMatchObject({
      problem: { code: 'forbidden' },
    })
    expect(instance.rows('browser-a')).toHaveLength(1)
  })

  it('用 baseVersion 阻止过期页面覆盖最新数据', async () => {
    const instance = createProjectCommandTestInstance({
      createId: () => 'opaque-1',
      now: () => '2026-08-15T08:00:00.000Z',
    })
    const created = await instance.execute(createRequest('command-create-1'), SESSION, 'browser-a')
    const update = {
      ...createRequest('command-update-1'),
      id: created.id,
      baseVersion: created.version,
      draft: { name: '最新名称', manager: '张经理', status: '筹备中' },
    }

    await expect(instance.execute(update, SESSION, 'browser-a')).resolves.toMatchObject({
      id: created.id,
      version: '2',
    })
    await expect(instance.execute({
      ...update,
      commandId: 'command-stale',
      draft: { ...update.draft, name: '过期页面名称' },
    }, SESSION, 'browser-a')).rejects.toMatchObject({
      problem: { code: 'conflict', retryable: false },
    })
    expect(instance.form(created.id, SESSION, 'browser-a')).toMatchObject({
      draft: { name: '最新名称' },
      version: '2',
    })
  })

  it('由服务端按 action 权威派生审批状态', async () => {
    const instance = createProjectCommandTestInstance({
      createId: () => 'opaque-lifecycle-1',
      now: () => '2026-08-15T08:00:00.000Z',
    })

    const created = await instance.execute({
      ...createRequest('command-lifecycle-draft'),
      draft: {
        ...createRequest('command-lifecycle-draft').draft,
        approvalStatus: 'approved',
      },
    }, SESSION, 'browser-a')
    expect(instance.form(created.id, SESSION, 'browser-a').draft.approvalStatus).toBe('draft')

    const saved = await instance.execute({
      ...createRequest('command-lifecycle-save'),
      id: created.id,
      baseVersion: created.version,
      action: 'save',
      draft: {
        ...createRequest('command-lifecycle-save').draft,
        customerId: 'customer-1',
        approvalStatus: 'rejected',
      },
    }, SESSION, 'browser-a')
    expect(instance.form(created.id, SESSION, 'browser-a').draft.approvalStatus).toBe('draft')

    await instance.execute({
      ...createRequest('command-lifecycle-submit'),
      id: created.id,
      baseVersion: saved.version,
      action: 'submit',
      draft: {
        ...createRequest('command-lifecycle-submit').draft,
        customerId: 'customer-1',
        approvalStatus: 'approved',
      },
    }, SESSION, 'browser-a')
    expect(instance.form(created.id, SESSION, 'browser-a').draft.approvalStatus).toBe('submitted')
  })

  it('不信任客户端传入的工作区、操作人和权限', async () => {
    const instance = createProjectCommandTestInstance()

    await expect(instance.execute({
      ...createRequest('command-spoof-workspace'),
      workspaceId: 'workspace-spoofed',
    }, SESSION)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await expect(instance.execute({
      ...createRequest('command-spoof-actor'),
      actorId: 'actor-spoofed',
    }, SESSION)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await expect(instance.execute(
      createRequest('command-no-capability'),
      { ...SESSION, capabilities: ['project:list:read'] },
    )).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  })

  it('在命令边界拒绝非法日期、负数与脏附件字段', async () => {
    const invalidRequests: unknown[] = [
      {
        ...createRequest('command-invalid-date'),
        draft: { ...createRequest('command-invalid-date').draft, startDate: '15/08/2026' },
      },
      {
        ...createRequest('command-negative-number'),
        draft: { ...createRequest('command-negative-number').draft, contractAmount: -1 },
      },
      {
        ...createRequest('command-invalid-attachment-text'),
        attachments: {
          add: [{ fileName: '立项.pdf', filePath: 123 }],
          removeIds: [],
          restoreIds: [],
        },
      },
      {
        ...createRequest('command-invalid-attachment-size'),
        attachments: {
          add: [{ fileName: '立项.pdf', fileSize: -1 }],
          removeIds: [],
          restoreIds: [],
        },
      },
      {
        ...createRequest('command-invalid-remove-id'),
        attachments: { add: [], removeIds: [''], restoreIds: [] },
      },
    ]

    for (const request of invalidRequests) {
      expect(() => parseProjectCommandRequest(request)).toThrowError(expect.objectContaining({
        problem: expect.objectContaining({ code: 'validation-failed' }),
      }))
    }

    const instance = createProjectCommandTestInstance()
    await expect(instance.execute(
      invalidRequests[2] as ProjectCommandRequestDTO,
      SESSION,
      'browser-a',
    )).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(instance.rows('browser-a')).toHaveLength(0)
  })

  it('命令成功后立即进入同一中央读模型', async () => {
    const commands = createProjectCommandTestInstance({
      createId: () => 'opaque-read-1',
      now: () => '2026-08-15T08:00:00.000Z',
    })
    const reads = createProjectReadTestInstance(
      () => SESSION.capabilities,
      sessionId => commands.rows(sessionId),
      sessionId => commands.sourceVersion(sessionId),
    )
    await commands.execute(createRequest('command-visible-1'), SESSION, 'browser-a')

    await expect(reads.list({ includeDemo: 'false' }, 'browser-a')).resolves.toMatchObject({
      items: [{
        dataOrigin: 'real',
        project: { id: 'opaque-read-1', label: '中央命令项目' },
      }],
      pagination: { total: 1 },
      asOf: '2026-08-15T08:00:00.000Z',
      sourceVersion: expect.stringContaining('project-command-1'),
    })
    await expect(reads.detail(
      'opaque-read-1',
      { dataOrigin: 'real' },
      'browser-a',
    )).resolves.toMatchObject({
      item: { project: { id: 'opaque-read-1', label: '中央命令项目' } },
      asOf: '2026-08-15T08:00:00.000Z',
    })
  })
})
