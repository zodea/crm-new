import type { DomainRepositories } from '~/plugins/repositories'
import { expect, it, vi } from 'vitest'
import { createTabRestoreValidator, inspectRestorableTabPath } from '~/lib/tabs/restore-target'
import { rosterProblem } from '~/lib/worker-roster/contract'

const workerPath = '/base/worker/private/worker-one?origin=real'
const rosterPath = '/subcontract/payroll/roster?origin=real&project=project-one'
function setup() {
  const profile = vi.fn(async () => ({ sourceVersion: 'private-current' }))
  const archives = vi.fn(async () => [])
  const list = vi.fn(async () => ({ context: { capabilities: ['payroll:read', 'worker:sensitive:read'] } }))
  const repositories = { workerRoster: { profile, archives }, payroll: { list } } as unknown as DomainRepositories
  const restore = createTabRestoreValidator({ repositories, includeDemo: () => false, capabilities: () => ['payroll:read'] })
  const descriptor = (fullPath: string) => ({ key: fullPath.split('?')[0]!, title: '旧标题', fullPath, origin: 'real' as const, targetVersion: 1, sourceVersion: null, updatedAt: 1, closable: true })
  return { restore, profile, list, archives, descriptor }
}
it('私密资料与名册冷恢复只保存阅读身份并拒绝演示或缺来源', async () => {
  expect(inspectRestorableTabPath(`${workerPath}&idCard=secret&draft=private`)).toEqual({ fullPath: workerPath, origin: 'real' })
  const f = setup()
  expect(await f.restore(f.descriptor(workerPath))).toMatchObject({ state: 'resolved', fullPath: workerPath, title: '工人私密资料', sourceVersion: 'private-current' })
  expect(f.profile).toHaveBeenCalledWith('worker-one')
  expect(await f.restore(f.descriptor(rosterPath))).toMatchObject({ state: 'resolved', fullPath: rosterPath })
  expect(f.archives).toHaveBeenCalledWith('project-one')
})

it.each([
  { case: 'workerPath.replace(\'?origin=real\', \'\')', input: workerPath.replace('?origin=real', '') },
  { case: 'rosterPath.replace(\'origin=real\', \'origin=demo\')', input: rosterPath.replace('origin=real', 'origin=demo') },
])('私密资料与名册冷恢复只保存阅读身份并拒绝演示或缺来源 / inspectRestorableTabPath：$case', ({ input }) => {
  expect(inspectRestorableTabPath(input)).toBeNull()
})
it('恢复私密页面必须从服务重新授权，撤权不能沿旧页签恢复', async () => {
  const f = setup()
  f.profile.mockImplementation(async () => rosterProblem('forbidden', '已撤权'))
  expect((await f.restore(f.descriptor(workerPath))).state).toBe('forbidden')
  f.list.mockResolvedValue({ context: { capabilities: ['payroll:read'] } })
  expect((await f.restore(f.descriptor(rosterPath))).state).toBe('forbidden')
  expect(f.archives).not.toHaveBeenCalled()
})
it('合法编码工人身份保持原身份，陈旧项目也不能恢复名册', async () => {
  const f = setup()
  const id = `legacy:${encodeURIComponent('旧工人')}`
  const path = `/base/worker/private/${encodeURIComponent(id)}?origin=real`
  expect((await f.restore(f.descriptor(path))).state).toBe('resolved')
  expect(f.profile).toHaveBeenCalledWith(id)
  f.archives.mockImplementation(async () => rosterProblem('not-found', '项目已不可读取'))
  expect((await f.restore(f.descriptor(rosterPath))).state).toBe('not-found')
})
