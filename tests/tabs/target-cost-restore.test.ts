import type { DomainRepositories } from '~/plugins/repositories'
import { expect, it, vi } from 'vitest'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { createTabRestoreValidator, inspectRestorableTabPath } from '~/lib/tabs/restore-target'
import { localTargetCostDetail } from '~/lib/target-cost/local-read'

vi.mock('~/lib/target-cost/local-read', () => ({ localTargetCostDetail: vi.fn() }))

it('演示冷恢复先核服务端授权，再用同一隔离只读adapter，不误打正式详情', async () => {
  const context = { workspaceId: 'w', actorId: 'a', origin: 'demo', sourceVersion: 'demo-v', capabilities: ['target-cost:read', 'demo:read'] }
  const list = vi.fn().mockResolvedValue({ context, rows: [] })
  const detail = vi.fn()
  vi.mocked(localTargetCostDetail).mockResolvedValue({ context, targetCostId: 'demo-budget', view: { header: { name: '演示预算' } } } as never)
  const validate = createTabRestoreValidator({ repositories: { targetCosts: { list, detail } } as unknown as DomainRepositories, capabilities: () => ['target-cost:read', 'demo:read'], includeDemo: () => true })
  const result = await validate({ key: '/project/target-cost/demo-budget', title: '演示预算', fullPath: '/project/target-cost/demo-budget?origin=demo', targetVersion: 1, origin: 'demo', sourceVersion: null, updatedAt: 1, closable: true })
  expect(result).toMatchObject({ state: 'resolved', sourceVersion: 'demo-v' })
  expect(list).toHaveBeenCalledWith({ origin: 'demo', includeDemo: true })
  expect(localTargetCostDetail).toHaveBeenCalledWith(context, 'demo-budget')
  expect(detail).not.toHaveBeenCalled()
})

it('预算只读恢复保留筛选和来源链，版本头及明细写态不恢复', async () => {
  const list = '/project/target-cost?origin=real&baseline=history&status=draft&page=2&pageSize=20&deleted=true'
  const path = `/project/target-cost/a?origin=real&tab=comparison&returnTo=${encodeURIComponent(list)}`
  expect(inspectRestorableTabPath(list)?.fullPath).toBe(list)
  expect(inspectRestorableTabPath('/project/target-cost/form/a?origin=real')).toBeNull()
  const detail = vi.fn().mockResolvedValue({ targetCostId: 'a', context: { origin: 'real', capabilities: ['target-cost:read'], sourceVersion: 'v2' }, view: { header: { name: '当前预算A' } } })
  const validate = createTabRestoreValidator({ repositories: { targetCosts: { detail } } as unknown as DomainRepositories, capabilities: () => ['target-cost:read'], includeDemo: () => false })
  const result = await validate({ key: '/project/target-cost/a', title: '旧名', fullPath: path, targetVersion: 1, origin: 'real', sourceVersion: 'v1', updatedAt: 1, closable: true })
  expect(result).toMatchObject({ state: 'resolved', title: '当前预算A', sourceVersion: 'v2' })
  if (result.state !== 'resolved')
    throw new Error('读取未恢复')
  expect(new URL(result.fullPath, 'https://ruihang.invalid').searchParams.get('returnTo')).toBe(list)
})

it('只有五个已接来源列表恢复预算身份，拒绝重复身份与写态来源', () => {
  const result = resolveNavigationTarget({ kind: 'entity-list', entity: 'settlement', variant: 'other_settlement', view: null, filters: { projectId: 'p', dataOrigin: 'real' } }, { returnTo: '/project/target-cost/a?origin=real&tab=comparison' })
  if (result.state !== 'resolved')
    throw new Error('未生成来源')
  expect(inspectRestorableTabPath(result.to)?.fullPath).toBe(result.to)
  expect(inspectRestorableTabPath(`${result.to}&budgetId=b`)).toBeNull()
  expect(inspectRestorableTabPath(result.to.replace('/contract/other-settlement?', '/contract/other-settlement/form?'))).toBeNull()
})
