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

  it('鉴权后同文返回首次结果，同键异文拒绝且保留原事实', async () => {
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
    }, SESSION, 'browser-a')).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(instance.execute(createRequest('command-replay-variant'), SESSION, 'browser-a')).resolves.toEqual(first)
    await expect(instance.execute({
      ...createRequest('command-replay-variant'),
      actorId: 'actor-spoofed',
    }, SESSION, 'browser-a')).rejects.toMatchObject({
      problem: { code: 'forbidden' },
    })
    expect(instance.rows('browser-a')).toHaveLength(1)
    expect(instance.form(first.id, SESSION, 'browser-a').draft.name).toBe('中央命令项目')
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

  it.each(Array.from(([
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
  ]) as unknown[]).map(input => ({ input })))('在命令边界拒绝非法日期、负数与脏附件字段：输入案例 %#', async ({ input: request }) => {
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

    expect(() => parseProjectCommandRequest(request)).toThrowError(expect.objectContaining({
      problem: expect.objectContaining({ code: 'validation-failed' }),
    }))

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
    const before = await reads.list({ includeDemo: 'false' }, 'browser-a')
    await commands.execute(createRequest('command-visible-1'), SESSION, 'browser-a')
    const readingStarted = Date.now()
    const page = await reads.list({ includeDemo: 'false' }, 'browser-a')
    expect(page).toMatchObject({
      items: [{
        dataOrigin: 'real',
        project: { id: 'opaque-read-1', label: '中央命令项目' },
      }],
      pagination: { total: 1 },
      meta: { workspaceId: SESSION.workspaceId, actorId: SESSION.actorId, dataOrigin: 'real' },
    })
    expect(Date.parse(page.asOf)).toBeGreaterThanOrEqual(readingStarted)
    expect(Date.parse(page.asOf)).toBeLessThanOrEqual(Date.now())
    const source = page.meta.sources.find(source => source.key === 'projects')!
    expect(source.state).toBe('readable')
    expect(source.sourceVersion).not.toBeNull()
    expect(source.sourceVersion).not.toBe(before.meta.sources.find(source => source.key === 'projects')!.sourceVersion)
    const detail = await reads.detail('opaque-read-1', { origin: 'real' }, 'browser-a')
    expect(detail).toMatchObject({
      item: { project: { id: 'opaque-read-1', label: '中央命令项目' }, updatedAt: '2026-08-15T08:00:00.000Z' },
    })
    expect(Date.parse(detail.asOf)).toBeGreaterThanOrEqual(readingStarted)
  })

  it('原命令核对只返回首次回执，未应用键封存，撤权和切换操作人不串回执', async () => {
    const instance = createProjectCommandTestInstance({ createId: () => 'project-resolve' })
    const original = await instance.execute(createRequest('project-original'), SESSION)
    expect(instance.resolve(original.commandId, SESSION)).toEqual({ outcome: 'applied', result: original })
    expect(instance.resolve('project-never-applied', SESSION)).toEqual({ outcome: 'not-applied', commandId: 'project-never-applied' })
    await expect(instance.execute(createRequest('project-never-applied'), SESSION)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(() => instance.resolve(original.commandId, { ...SESSION, capabilities: [] })).toThrow(/权限/)
    expect(instance.resolve(original.commandId, { ...SESSION, actorId: 'other' })).toEqual({ outcome: 'not-applied', commandId: original.commandId })
    expect(instance.resolve(original.commandId, SESSION)).toEqual({ outcome: 'applied', result: original })
  })
})
