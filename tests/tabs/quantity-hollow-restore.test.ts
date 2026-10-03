import type { DomainRepositories } from '~/plugins/repositories'
import { expect, it, vi } from 'vitest'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { createTabRestoreValidator, inspectRestorableTabPath } from '~/lib/tabs/restore-target'
import { createQuantityHollowFixture } from '../helpers/quantity-hollow-fixture'

it.each(['record', 'revision', 'project', 'unit'] as const)('空鼓冷恢复拒绝错配 %s 并保工资原稿返回', async (identity) => {
  const f = await createQuantityHollowFixture()
  try {
    const initial = await f.service.hollow(f.scope)
    const created = await f.service.executeHollow(f.command(initial, { kind: 'create-hollow-inspection', target: initial.data.targets[0]!.target, input: { inspectedOn: '2026-08-10', count: 19, note: '原检查' } }))
    const checked = await f.service.hollow(f.scope)
    const source = checked.data.records[0]!.source.navigation!
    const back = `/subcontract/payroll/new?${new URLSearchParams({ origin: 'real', project: f.scope.projectId, month: '2026-08', draftKey: 'original-draft', focus: 'original-completion' })}`
    const target = resolveNavigationTarget(source, { returnTo: back })
    if (target.state !== 'resolved')
      throw new Error('公开原户来源不可达')
    await f.service.executeHollow(f.command(checked, { kind: 'rectify-hollow-inspection', recordId: created.hollow.recordId, expectedRevisionId: created.hollow.revisionId, rectifiedOn: '2026-08-15', count: 4, note: '追加整改' }))
    const hollow = vi.fn((query: typeof f.scope) => f.reload().hollow(query))
    let capabilities = f.session().capabilities
    const validate = createTabRestoreValidator({ repositories: { quantity: { hollow } } as unknown as DomainRepositories, capabilities: () => capabilities, includeDemo: () => false })
    const url = new URL(target.to, 'https://test.invalid')
    const descriptor = { key: url.pathname, fullPath: target.to, title: '原检查', origin: 'real' as const, targetVersion: 1, sourceVersion: 'old', updatedAt: 1, closable: true }
    expect(inspectRestorableTabPath(target.to)?.fullPath).toBe(target.to)
    const restored = await validate(descriptor)
    expect(restored).toMatchObject({ state: 'resolved', fullPath: target.to })
    expect(hollow).toHaveBeenCalledWith(f.scope, { signal: undefined })
    const identities = { record: created.hollow.recordId, revision: created.hollow.revisionId, project: f.scope.projectId, unit: f.scope.unitId }
    const fullPath = target.to.replace(identities[identity], `wrong-${identity}`)
    expect((await validate({ ...descriptor, fullPath })).state).not.toBe('resolved')
    capabilities = []
    hollow.mockClear()
    expect((await validate(descriptor)).state).toBe('forbidden')
    expect(hollow).not.toHaveBeenCalled()
  }
  finally { await f.close() }
}, 30_000)
