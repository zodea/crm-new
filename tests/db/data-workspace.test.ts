import type { DbDriver } from '~/lib/db/coordinator'
import { describe, expect, it, vi } from 'vitest'
import { demoReadOnlyDriver, localDataWorkspace } from '~/lib/db/data-workspace'

describe('local data workspace boundary', () => {
  it('keeps production empty and gives demo an isolated seeded snapshot', () => {
    expect(localDataWorkspace(false)).toEqual({
      snapshotKey: 'production',
      seedDemo: false,
      readOnly: false,
    })
    expect(localDataWorkspace(true)).toEqual({
      snapshotKey: 'demo',
      seedDemo: true,
      readOnly: true,
    })
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
    await expect(driver.select('DELETE FROM projects RETURNING id')).rejects.toMatchObject({
      code: 'demo-workspace-read-only',
    })
    await expect(
      driver.select('WITH selected AS (SELECT id FROM projects) DELETE FROM projects'),
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
    expect(select).toHaveBeenCalledTimes(2)
  })
})
