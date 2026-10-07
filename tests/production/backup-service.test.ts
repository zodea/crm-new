import { mkdir, mkdtemp, readFile, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createProductionBackupService } from '../../server/utils/production-backup-service'
import { createProductionStorage } from '../../server/utils/production-storage'

async function fixture() {
  const base = resolve('.tmp/opt02-backup-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/service-`)
  const locations = Object.fromEntries(['source', 'staging', 'nas', 'offline', 'restore'].map(name => [name, join(directory, name)]))
  for (const path of Object.values(locations)) await mkdir(path)
  const identity = { workspaceId: 'service-workspace', ownerId: 'service-owner', purpose: 'verification' as const }
  const storage = createProductionStorage({ ...identity, directory: locations.source! })
  const config = { stagingDirectory: locations.staging!, primaryDirectory: locations.nas!, offlineDirectory: locations.offline!, restoreDirectory: locations.restore!, intervalHours: 12, dailyCopies: 30, monthlyCopies: 12 }
  const session = () => ({ workspaceId: identity.workspaceId, actorId: identity.ownerId, capabilities: [] })
  return { identity, storage, config, session, directory, locations }
}

it('计划补跑、原键回执、介质失败保上份、离线时点和隔离恢复证明持久一致', async () => {
  const f = await fixture()
  let now = '2026-09-22T00:00:00.000Z'
  const service = createProductionBackupService(f.storage, f.config, () => now)
  try {
    expect((await service.status(f.session)).protection).toBe('never')
    const first = await service.scheduled()
    expect(first?.state).toBe('succeeded')
    expect(await service.scheduled()).toBeNull()
    const request = { commandId: 'manual-copy', action: 'copy-offline', sourceBackupId: first!.packageId }
    now = '2026-09-22T01:00:00.000Z'
    const copy = await service.execute(request, f.session)
    expect(copy.capturedAt).toBe(first!.capturedAt)
    expect(await service.execute(request, f.session)).toEqual(copy)
    await expect(service.execute({ ...request, action: 'verify-restore' }, f.session)).rejects.toThrow('同一')
    const restored = await service.execute({ ...request, commandId: 'isolated-proof', action: 'verify-restore' }, f.session)
    expect(restored.state).toBe('succeeded')
    expect((await service.status(f.session)).baseline).toMatchObject({ packageId: first!.packageId, current: true })
    const original = await readFile(join(f.config.primaryDirectory, first!.packageId!, 'data.sqlite'))
    await rename(f.config.primaryDirectory, `${f.config.primaryDirectory}-disconnected`)
    now = '2026-09-22T12:00:00.000Z'
    expect((await service.scheduled())?.state).toBe('failed')
    const failed = await service.status(f.session)
    expect(failed.protection).toBe('failed')
    expect(failed.latest?.packageId).toBe(first!.packageId)
    expect(await service.scheduled()).toBeNull()
    await rename(`${f.config.primaryDirectory}-disconnected`, f.config.primaryDirectory)
    expect((await readFile(join(f.config.primaryDirectory, first!.packageId!, 'data.sqlite'))).equals(original)).toBe(true)
    await f.storage.close()
    const cold = createProductionStorage({ ...f.identity, directory: f.locations.source! })
    try {
      const reopened = createProductionBackupService(cold, f.config, () => now)
      expect((await reopened.status(f.session)).baseline).toEqual(failed.baseline)
      expect(await reopened.execute(request, f.session)).toEqual(copy)
      now = '2026-09-22T12:16:00.000Z'
      expect((await reopened.scheduled())?.state).toBe('succeeded')
      expect((await reopened.status(f.session)).protection).toBe('protected')
    }
    finally { await cold.close() }
  }
  finally { await f.storage.close() }
})

it('失效会话不能确认成功；中断回执冷启动标明未确认，不自动放开正式写入', async () => {
  const f = await fixture()
  let now = '2026-09-22T00:00:00.000Z'
  let calls = 0
  const session = () => {
    calls++
    if (calls >= 4)
      throw new Error('session revoked')
    return f.session()
  }
  const service = createProductionBackupService(f.storage, f.config, () => now)
  try {
    await expect(service.execute({ commandId: 'revoked-owner', action: 'backup', sourceBackupId: null }, session)).rejects.toThrow('session revoked')
    expect((await service.status(f.session)).recent[0]?.state).toBe('failed')
    now = '2026-09-22T01:00:00.000Z'
    await f.storage.execute('INSERT INTO production_backup_runs(id,action,fingerprint,actor_id,state,started_at) VALUES(\'interrupted-operation\',\'backup\',\'test\',?,\'running\',?)', [f.identity.ownerId, now])
    const restarted = createProductionBackupService(f.storage, f.config, () => now)
    expect((await restarted.status(f.session)).recent[0]).toMatchObject({ commandId: 'interrupted-operation', state: 'failed', message: expect.stringContaining('停止') })
    await expect(restarted.execute({ commandId: 'invalid origin', action: 'backup', sourceBackupId: null }, f.session)).rejects.toThrow('编号')
    await expect(restarted.execute({ commandId: 'invalid-envelope', action: 'backup', sourceBackupId: null, origin: 'demo' }, f.session)).rejects.toThrow('内容')
    expect((await restarted.status(f.session)).releaseState).toBe('awaiting-final-acceptance')
  }
  finally { await f.storage.close() }
})
