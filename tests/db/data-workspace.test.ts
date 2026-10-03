import type { DbDriver } from '~/lib/db/coordinator'
import { describe, expect, it, vi } from 'vitest'
import {
  demoReadOnlyDriver,
  legacyProductionReadOnlyDriver,
  localDataWorkspace,
} from '~/lib/db/data-workspace'

describe('local data workspace boundary', () => {
  it.each([
    { case: 'false', input: false, argument2: undefined, expected: {
      snapshotKey: 'production',
      seedDemo: false,
      readOnly: false,
    } },
    { case: 'false / true', input: false, argument2: true, expected: {
      snapshotKey: 'production',
      seedDemo: false,
      readOnly: true,
    } },
    { case: 'true', input: true, argument2: undefined, expected: {
      snapshotKey: 'demo',
      seedDemo: true,
      readOnly: true,
    } },
  ])('keeps production empty and gives demo an isolated seeded snapshot / localDataWorkspace：$case', ({ input, argument2, expected }) => {
    expect(localDataWorkspace(input, argument2)).toEqual(expected)
  })

  it('lets demo reads through but rejects every formal write seam', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)
    const select = vi.fn().mockResolvedValue([{ id: 'demo-1' }])
    const close = vi.fn().mockResolvedValue(undefined)
    const driver = demoReadOnlyDriver({ execute, select, close } satisfies DbDriver)

    await expect(driver.select('SELECT * FROM projects')).resolves.toEqual([{ id: 'demo-1' }])
    await expect(
      driver.select('WITH visible AS (SELECT * FROM projects) SELECT * FROM visible'),
    )
      .resolves
      .toEqual([{ id: 'demo-1' }])
    await expect(
      driver.select('SELECT * FROM operation_logs WHERE action = \'delete\''),
    )
      .resolves
      .toEqual([{ id: 'demo-1' }])
    await expect(driver.select('DELETE FROM projects RETURNING id')).rejects.toMatchObject({
      code: 'demo-workspace-read-only',
    })
    await expect(
      driver.select('WITH selected AS (SELECT id FROM projects) DELETE FROM projects'),
    )
      .rejects
      .toMatchObject({ code: 'demo-workspace-read-only' })
    await expect(
      driver.select('SELECT id FROM projects; DELETE FROM projects'),
    )
      .rejects
      .toMatchObject({ code: 'demo-workspace-read-only' })
    await expect(driver.execute('DELETE FROM projects')).rejects.toMatchObject({
      code: 'demo-workspace-read-only',
    })
    await expect(driver.execute('BEGIN; DELETE FROM projects')).rejects.toMatchObject({
      code: 'demo-workspace-read-only',
    })
    await expect(driver.execute('BEGIN')).resolves.toBeUndefined()
    expect(execute).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith('BEGIN', undefined)
    expect(select).toHaveBeenCalledTimes(3)
  })

  it('locks the legacy production source after central cutover without disguising it as demo', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)
    const select = vi.fn().mockResolvedValue([{ id: 'legacy-project' }])
    const close = vi.fn().mockResolvedValue(undefined)
    const driver = legacyProductionReadOnlyDriver({ execute, select, close } satisfies DbDriver)

    await expect(driver.select('SELECT * FROM projects')).rejects.toMatchObject({
      code: 'legacy-production-read-only',
    })
    await expect(driver.execute('UPDATE projects SET name = ?')).rejects.toMatchObject({
      code: 'legacy-production-read-only',
    })
    await expect(driver.execute('BEGIN')).rejects.toMatchObject({
      code: 'legacy-production-read-only',
    })

    expect(select).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })
})
