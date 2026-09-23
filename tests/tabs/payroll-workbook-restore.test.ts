import type { DomainRepositories } from '~/plugins/repositories'
import { expect, it, vi } from 'vitest'
import { payrollAdjustmentReturn } from '~/lib/payroll/adjustment-navigation'
import { payrollProblem } from '~/lib/payroll/central-contract'
import { createTabRestoreValidator, inspectRestorableTabPath } from '~/lib/tabs/restore-target'

const path = '/subcontract/payroll/workbooks?origin=real&project=project-one&mode=leader-cycle&subject=project-one%3Aleader-one%3AA%3Aordinary%3A&archive=directory-one'
it('工资目录冷恢复仅带公开身份，重新受权读取原目录且不预读私密正文', async () => {
  expect(inspectRestorableTabPath(path)).toMatchObject({ fullPath: path, origin: 'real' })
  expect(payrollAdjustmentReturn(path, 'real')).toBe(path)
  expect(inspectRestorableTabPath(path.replace('origin=real', 'origin=demo'))).toBeNull()
  expect(inspectRestorableTabPath(`${path}&payload=private`)).toBeNull()
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

it('跳实名名册保留所选原工资身份和安全返回路径，不接收跨来源返回', () => {
  const query = new URLSearchParams({ origin: 'real', project: 'project-one', returnTo: path })
  query.append('statement', 'salary-one')
  query.append('statement', 'salary:import:%E5%B7%A5%E8%B5%84')
  const rosterPath = `/subcontract/payroll/roster?${query}`
  expect(inspectRestorableTabPath(rosterPath)?.fullPath).toBe(rosterPath)
  expect(payrollAdjustmentReturn(path, 'demo')).toBeNull()
  expect(payrollAdjustmentReturn('//outside.invalid', 'real')).toBeNull()
})
