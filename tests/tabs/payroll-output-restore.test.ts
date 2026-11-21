import type { DomainRepositories } from '~/plugins/repositories'
import { describe, expect, it, vi } from 'vitest'
import { payrollAdjustmentReturn } from '~/lib/payroll/adjustment-navigation'
import { payrollProblem } from '~/lib/payroll/central-contract'
import { createTabRestoreValidator, inspectRestorableTabPath } from '~/lib/tabs/restore-target'
import { readPayrollStartupDescriptors } from '../../app/lib/payroll/startup-recovery'

describe('工资编号恢复', () => {
  const path = '/subcontract/payroll/issue/wage-one?origin=real&project=project-one'
  it('正式出具冷恢复只保留明确原项目与工资身份并重新读取', async () => {
    expect(inspectRestorableTabPath(path)).toMatchObject({ fullPath: path, origin: 'real' })
    const numbering = vi.fn(async () => ({ context: { sourceVersion: 'latest-original' } }))
    const restore = createTabRestoreValidator({ repositories: { payroll: { numbering } } as unknown as DomainRepositories, capabilities: () => ['payroll:read'], includeDemo: () => false })
    const descriptor = { key: '/subcontract/payroll/issue/wage-one', title: '旧标题', fullPath: path, origin: 'real' as const, targetVersion: 1, sourceVersion: null, updatedAt: 1, closable: true }
    expect(await restore(descriptor)).toMatchObject({ state: 'resolved', fullPath: path, sourceVersion: 'latest-original' })
    expect(numbering).toHaveBeenCalledWith({ origin: 'real', projectId: 'project-one' }, { projectId: 'project-one', statementId: 'wage-one' })
    numbering.mockRejectedValueOnce(payrollProblem('forbidden', '权限已变化'))
    expect((await restore(descriptor)).state).toBe('forbidden')
  })

  it.each([
    { case: 'path.replace(\'&project=project-one\', \'\')', input: path.replace('&project=project-one', '') },
    { case: 'path.replace(\'origin=real\', \'origin=demo\')', input: path.replace('origin=real', 'origin=demo') },
  ])('正式出具冷恢复只保留明确原项目与工资身份并重新读取 / inspectRestorableTabPath：$case', ({ input }) => {
    expect(inspectRestorableTabPath(input)).toBeNull()
  })
})

describe('工资工作簿恢复', () => {
  const path = '/subcontract/payroll/workbooks?origin=real&project=project-one&mode=leader-cycle&subject=project-one%3Aleader-one%3AA%3Aordinary%3A&archive=directory-one'
  it('工资目录冷恢复仅带公开身份，重新受权读取原目录且不预读私密正文', async () => {
    expect(inspectRestorableTabPath(path)).toMatchObject({ fullPath: path, origin: 'real' })
    expect(payrollAdjustmentReturn(path, 'real')).toBe(path)
    const list = vi.fn(async () => ({ context: { sourceVersion: 'current' } }))
    const workbookArchive = vi.fn(async () => ({}))
    const privateRead = vi.fn()
    const restore = createTabRestoreValidator({ repositories: { payroll: { list, workbookArchive }, workerRoster: { archive: privateRead } } as unknown as DomainRepositories, capabilities: () => ['payroll:read'], includeDemo: () => false })
    const descriptor = { key: '/subcontract/payroll/workbooks', title: '旧标题', fullPath: path, origin: 'real' as const, targetVersion: 1, sourceVersion: null, updatedAt: 1, closable: true }
    expect(await restore(descriptor)).toMatchObject({ state: 'resolved', fullPath: path, sourceVersion: 'current' })
    expect(workbookArchive).toHaveBeenCalledWith({ origin: 'real', projectId: 'project-one' }, { projectId: 'project-one', archiveId: 'directory-one' })
    expect(privateRead).not.toHaveBeenCalled()
    workbookArchive.mockRejectedValueOnce(payrollProblem('forbidden', '权限已收回'))
    expect((await restore(descriptor)).state).toBe('forbidden')
  })

  it.each([
    { case: 'path.replace(\'origin=real\', \'origin=demo\')', input: path.replace('origin=real', 'origin=demo') },
    { case: '`{path}&payload=private`', input: `${path}&payload=private` },
  ])('工资目录冷恢复仅带公开身份，重新受权读取原目录且不预读私密正文 / inspectRestorableTabPath：$case', ({ input }) => {
    expect(inspectRestorableTabPath(input)).toBeNull()
  })

  it('跳实名名册保留所选原工资身份和安全返回路径，不接收跨来源返回', () => {
    const query = new URLSearchParams({ origin: 'real', project: 'project-one', returnTo: path })
    query.append('statement', 'salary-one')
    query.append('statement', 'salary:import:%E5%B7%A5%E8%B5%84')
    const rosterPath = `/subcontract/payroll/roster?${query}`
    expect(inspectRestorableTabPath(rosterPath)?.fullPath).toBe(rosterPath)
  })

  it.each([
    { case: 'path / \'demo\'', input: path, argument2: 'demo' },
    { case: '\'//outside.invalid\' / \'real\'', input: '//outside.invalid', argument2: 'real' },
  ])('跳实名名册保留所选原工资身份和安全返回路径，不接收跨来源返回 / payrollAdjustmentReturn：$case', ({ input, argument2 }) => {
    expect(payrollAdjustmentReturn(input, argument2)).toBeNull()
  })
})

describe('工资生产启动恢复', () => {
  const actor = { workspaceId: 'formal-workspace', actorId: 'formal-owner' }
  function fixture(bucket: string, scope: unknown[], targetId: string | null, action: string) {
    const entryKey = JSON.stringify(scope)
    const descriptor = { ...actor, family: 'payroll', commandId: 'original-payroll-command', targetId, action, scopeId: encodeURIComponent(entryKey) }
    const encoded = JSON.stringify({ [entryKey]: descriptor })
    const storage = { getItem: (key: string) => key === bucket ? encoded : null }
    return { storage, descriptor, entryKey }
  }
  it('按当前身份、真实原单和格式保刷新位置；别人的编号、另一目标、配置及模拟来源不能借用', () => {
    const f = fixture('payroll-c1-central-pending-v1', [actor.workspaceId, actor.actorId, 'real', 'C1', 'original-c1'], 'original-c1', 'release-c1')
    expect(readPayrollStartupDescriptors('/subcontract/payroll/form/original-c1?origin=real', actor, f.storage)).toEqual([{ descriptor: f.descriptor, storageKey: 'payroll-c1-central-pending-v1', entryKey: f.entryKey }])
    expect(readPayrollStartupDescriptors('/subcontract/payroll/form/other-c1', actor, f.storage)).toEqual([])
    expect(readPayrollStartupDescriptors('/subcontract/payroll/payments/other-c1', actor, f.storage)).toEqual([])
    expect(readPayrollStartupDescriptors('/subcontract/payroll/form/original-c1?origin=mock', actor, f.storage)).toEqual([])
    expect(readPayrollStartupDescriptors('/subcontract/payroll/form/original-c1', { ...actor, actorId: 'another-owner' }, f.storage)).toEqual([])
    expect(readPayrollStartupDescriptors('/subcontract/payroll/config?format=A', actor, f.storage)).toEqual([])
  })
  it('考勤本人日期、原计划、编号及新草稿保准确范围；无scope和坏存储整批停止', () => {
    const a = fixture('payroll-attendance-central-pending-v1', [actor.workspaceId, actor.actorId, 'real', 'attendance', 'project-one', 'worker-one', '2026-08-03'], null, 'upsert-attendance')
    expect(readPayrollStartupDescriptors('/subcontract/attendance?projectId=project-one&month=2026-08', actor, a.storage)).toHaveLength(1)
    expect(readPayrollStartupDescriptors('/subcontract/attendance?projectId=project-two&month=2026-08', actor, a.storage)).toEqual([])
    expect(readPayrollStartupDescriptors('/subcontract/attendance?projectId=project-one&month=2026-09', actor, a.storage)).toEqual([])
    const n = fixture('payroll-numbering-pending-v1', [actor.workspaceId, actor.actorId, 'project-one', 'original-c1'], 'original-c1', 'issue')
    expect(readPayrollStartupDescriptors('/subcontract/payroll/issue/original-c1?projectId=project-one', actor, n.storage)).toHaveLength(1)
    expect(readPayrollStartupDescriptors('/subcontract/payroll/form/original-c1', actor, n.storage)).toEqual([])
    const draft = fixture('payroll-c2-central-pending-v1', [actor.workspaceId, actor.actorId, 'real', 'C2', 'draft-one'], null, 'save-c2-draft')
    expect(readPayrollStartupDescriptors('/subcontract/payroll/new?format=C2&draftKey=draft-one', actor, draft.storage)).toHaveLength(1)
    expect(readPayrollStartupDescriptors('/subcontract/payroll/new?format=C2&draftKey=other-draft', actor, draft.storage)).toEqual([])
    expect(() => readPayrollStartupDescriptors('/subcontract/payroll', actor, { getItem: () => '{broken' })).toThrow('损坏')
    const bad = { ...draft.descriptor, scopeId: 'unproved-key' }
    expect(() => readPayrollStartupDescriptors('/subcontract/payroll/new?format=C2', actor, { getItem: key => key.includes('-c2-') ? JSON.stringify({ [draft.entryKey]: bad }) : null })).toThrow('稳定上下文')
  })
})
