import type { DomainRepositories } from '~/plugins/repositories'
import { expect, it, vi } from 'vitest'
import { payrollProblem } from '~/lib/payroll/central-contract'
import { createTabRestoreValidator, inspectRestorableTabPath } from '~/lib/tabs/restore-target'

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
