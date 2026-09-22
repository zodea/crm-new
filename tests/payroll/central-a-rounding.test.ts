import type { PayrollARoundingCommand } from '../../app/lib/payroll/central-a-rounding-contract'
import { afterEach, describe, expect, it } from 'vitest'
import { createPayrollAServiceFixture } from '../helpers/payroll-a-service-fixture'

const closers: Array<() => Promise<void>> = []
afterEach(async () => Promise.all(closers.splice(0).map(close => close())))

describe('central A payroll rounding revisions', () => {
  it('keeps missing distinct from explicit off and replays only the same original command', async () => {
    const f = await createPayrollAServiceFixture()
    closers.push(f.close)
    const scope = { projectId: 'p', leaderWorkerId: 'w', book: { bookPurpose: 'ordinary' as const, managementBookId: null }, month: '2026-08' }
    const missing = await f.service.aRounding({ origin: 'real' }, scope)
    expect(missing.current).toBeNull()
    expect(missing.revisions).toEqual([])

    const command: PayrollARoundingCommand = { schemaVersion: 1, commandId: 'round-command', workspaceId: missing.context.workspaceId, actorId: missing.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: missing.context.sourceVersion, scope, action: { kind: 'save-a-rounding', rule: { kind: 'off' } } }
    const saved = await f.service.executeARounding(command)
    expect(saved).toMatchObject({ schemaVersion: 1, commandId: command.commandId, revision: { projectId: 'p', leaderWorkerId: 'w', book: scope.book, effectiveMonth: '2026-08', revision: 1, rule: { kind: 'off' } } })
    expect(await f.service.executeARounding(command)).toEqual(saved)
    await expect(f.service.executeARounding({ ...command, action: { kind: 'save-a-rounding', rule: { kind: 'floor', stepFen: 10_000 } } })).rejects.toMatchObject({ problem: { code: 'conflict' } })

    const current = await f.service.aRounding({ origin: 'real' }, scope)
    expect(current.current).toEqual(saved.revision)
    expect(current.revisions).toEqual([saved.revision])
    await expect(f.service.executeARounding({ ...command, commandId: 'stale-round-command' })).rejects.toMatchObject({ problem: { code: 'stale-source' } })
  })

  it('appends a later effective revision and preserves the earlier month', async () => {
    const f = await createPayrollAServiceFixture()
    closers.push(f.close)
    const augustScope = { projectId: 'p', leaderWorkerId: 'w', book: { bookPurpose: 'ordinary' as const, managementBookId: null }, month: '2026-08' }
    const august = await f.service.aRounding({ origin: 'real' }, augustScope)
    await f.service.executeARounding({ schemaVersion: 1, commandId: 'round-august', workspaceId: august.context.workspaceId, actorId: august.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: august.context.sourceVersion, scope: augustScope, action: { kind: 'save-a-rounding', rule: { kind: 'off' } } })

    const septemberScope = { ...augustScope, month: '2026-09' }
    const september = await f.service.aRounding({ origin: 'real' }, septemberScope)
    const floor = await f.service.executeARounding({ schemaVersion: 1, commandId: 'round-september', workspaceId: september.context.workspaceId, actorId: september.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: september.context.sourceVersion, scope: septemberScope, action: { kind: 'save-a-rounding', rule: { kind: 'floor', stepFen: 10_000 } } })

    expect((await f.service.aRounding({ origin: 'real' }, augustScope)).current?.rule).toEqual({ kind: 'off' })
    expect((await f.service.aRounding({ origin: 'real' }, septemberScope)).current).toEqual(floor.revision)
    expect(floor.revision.revision).toBe(2)
  })
})
