import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { expect, it, vi } from 'vitest'
import { createProductionBackupService } from '../../server/utils/production-backup-service'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { runColdProcess } from '../helpers/cold-process'
import { testTempRoot } from '../helpers/test-temp-root'

// Old behavior may call this during the red test; the stub never deletes anything.
const prune = vi.hoisted(() => vi.fn(async () => ({ removed: [], skipped: [] })))
vi.mock('../../server/utils/production-backup-retention', () => ({ pruneProductionBackups: prune }))
const cleanupTrace = vi.hoisted(() => ({ root: '', log: '', removed: [] as string[] }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...original,
    async rmdir(path: Parameters<typeof original.rmdir>[0]) {
      if (typeof path !== 'string' || !cleanupTrace.root)
        throw new Error('只允许清理本次合成目录的空 pending 目录')
      const child = relative(cleanupTrace.root, resolve(path))
      const parts = child.split(sep)
      if (isAbsolute(child) || parts.length !== 2 || !['primary', 'offline'].includes(parts[0]!)
        || !/^pending-backup-[a-f0-9-]{36}-[a-f0-9-]{36}$/.test(parts[1]!)) {
        throw new Error('空 pending 清理目标不属于本次合成目录')
      }
      const stat = await original.lstat(path)
      if (!stat.isDirectory() || stat.isSymbolicLink() || (await original.readdir(path)).length)
        throw new Error('合成 pending 目录非普通空目录，停止清理')
      const logStat = await original.lstat(cleanupTrace.log)
      if (!logStat.isFile() || logStat.isSymbolicLink())
        throw new Error('合成清理记录不是普通文件，停止清理')
      await original.appendFile(cleanupTrace.log, `开始 ${child}\n`, 'utf8')
      await original.rmdir(path)
      await original.appendFile(cleanupTrace.log, `完成 ${child}\n`, 'utf8')
      cleanupTrace.removed.push(child)
    },
  }
})

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

it('主备份、计划备份与离线复制不自动清理，原回执和已验证副本可独立冷读', { timeout: 60000 }, async () => {
  const taskRoot = testTempRoot()
  const directory = await mkdtemp(join(taskRoot, 'paused-backup-'))
  cleanupTrace.root = directory
  cleanupTrace.log = join(directory, 'pending-cleanup.log')
  cleanupTrace.removed.length = 0
  await writeFile(cleanupTrace.log, '', { flag: 'wx' })
  const roots = Object.fromEntries(['source', 'staging', 'primary', 'offline', 'restore'].map(name => [name, join(directory, name)]))
  for (const path of Object.values(roots)) await mkdir(path!)
  const identity = { workspaceId: 'paused-backup-workspace', actorId: 'paused-backup-owner' }
  const storage = createProductionStorage({ directory: roots.source!, workspaceId: identity.workspaceId, ownerId: identity.actorId, purpose: 'verification' })
  const config = { stagingDirectory: roots.staging!, primaryDirectory: roots.primary!, offlineDirectory: roots.offline!, restoreDirectory: roots.restore!, intervalHours: 12, dailyCopies: 1, monthlyCopies: 1 }
  const session = () => ({ ...identity, capabilities: [] })
  let now = '2026-09-20T00:00:00.000Z'
  const service = createProductionBackupService(storage, config, () => now)
  let closed = false
  try {
    const sentinel = new TextEncoder().encode('仅供本次隔离测试的未知文件')
    for (const name of ['staging', 'primary', 'offline'])
      await writeFile(join(roots[name]!, 'synthetic-unclassified.txt'), sentinel, { flag: 'wx' })
    const customerSession = () => ({ ...identity, capabilities: ['customer:list:read', 'customer:write'] })
    const original = Buffer.from('仅供本次备份验证的合成客户附件')
    const customer = await createProductionCustomerService(storage).execute({
      ...identity,
      requiredCapability: 'customer:write',
      commandId: 'paused-backup-customer',
      baseVersion: null,
      action: 'save',
      draft: { name: '合成备份客户', contact: '合成联系人' },
      attachments: { add: [{ fileName: '合成客户附件.txt', fileSize: original.length, mimeType: 'text/plain', contentBase64: original.toString('base64') }] },
    }, customerSession)
    expect(customer.attachmentIds).toHaveLength(1)
    const request = { action: 'backup' as const, commandId: 'paused-backup-first', sourceBackupId: null }
    const first = await service.execute(request, session)
    expect(first.state).toBe('succeeded')
    expect(first.packageId).toMatch(/^backup-[a-f0-9-]{36}$/)
    const afterBackup = prune.mock.calls.length
    const firstCopyRequest = { action: 'copy-offline' as const, commandId: 'paused-offline-first', sourceBackupId: first.packageId }
    const firstCopy = await service.execute(firstCopyRequest, session)
    expect(firstCopy).toMatchObject({ state: 'succeeded', packageId: first.packageId, capturedAt: first.capturedAt })
    const afterOffline = prune.mock.calls.length
    const proof = await service.execute({ action: 'verify-restore', commandId: 'paused-restore-first', sourceBackupId: first.packageId }, session)
    expect(proof.state).toBe('succeeded')
    const afterRestore = prune.mock.calls.length
    const snapshots: Record<string, { data: string, manifest: string }> = {}
    for (const name of ['staging', 'primary', 'offline']) {
      const path = join(roots[name]!, first.packageId!)
      snapshots[name] = { data: digest(await readFile(join(path, 'data.sqlite'))), manifest: digest(await readFile(join(path, 'manifest.json'))) }
    }
    expect(new Set(Object.values(snapshots).map(copy => copy.data)).size).toBe(1)
    expect(new Set(Object.values(snapshots).map(copy => copy.manifest)).size).toBe(1)
    now = '2026-09-22T00:00:00.000Z'
    const second = await service.scheduled()
    expect(second?.state).toBe('succeeded')
    expect(second?.packageId).not.toBe(first.packageId)
    const afterScheduled = prune.mock.calls.length
    const secondCopy = await service.execute({ action: 'copy-offline', commandId: 'paused-offline-second', sourceBackupId: second!.packageId }, session)
    expect(secondCopy).toMatchObject({ state: 'succeeded', packageId: second!.packageId })
    const afterSecondOffline = prune.mock.calls.length
    expect(await service.execute(request, session)).toEqual(first)
    expect(await service.execute(firstCopyRequest, session)).toEqual(firstCopy)
    const status = await service.status(session)
    expect(status.latest).toEqual(second)
    expect(status.baseline).toMatchObject({ packageId: first.packageId, current: true })
    for (const name of ['staging', 'primary', 'offline']) {
      const path = join(roots[name]!, first.packageId!)
      expect(digest(await readFile(join(path, 'data.sqlite')))).toBe(snapshots[name]!.data)
      expect(digest(await readFile(join(path, 'manifest.json')))).toBe(snapshots[name]!.manifest)
      expect(await readFile(join(roots[name]!, 'synthetic-unclassified.txt'))).toEqual(Buffer.from(sentinel))
    }
    expect({ backup: afterBackup, offline: afterOffline - afterBackup, restore: afterRestore - afterOffline, scheduled: afterScheduled - afterRestore, secondOffline: afterSecondOffline - afterScheduled }).toEqual({ backup: 0, offline: 0, restore: 0, scheduled: 0, secondOffline: 0 })
    expect(cleanupTrace.removed.map(path => path.split(sep)[0])).toEqual(['primary', 'offline', 'primary', 'offline'])
    const cleanupLog = await readFile(cleanupTrace.log, 'utf8')
    for (const path of cleanupTrace.removed)
      expect(cleanupLog).toContain(`开始 ${path}\n完成 ${path}\n`)
    await storage.close()
    closed = true
    const env = { ...process.env }
    for (const key of Object.keys(env)) {
      if (/^(?:CRM_|NUXT_|NITRO_)/.test(key))
        delete env[key]
    }
    const { stdout } = await runColdProcess('production-backup-paused-cold', [taskRoot, directory, first.packageId!, customer.id, customer.attachmentIds[0]!], { env })
    const cold = JSON.parse(stdout)
    expect(cold.pid).not.toBe(process.pid)
    expect(cold.replay).toEqual(first)
    expect(cold.latest).toEqual(second)
    expect(cold.baseline).toMatchObject({ packageId: first.packageId, current: true })
    expect(cold.copies).toEqual(Object.fromEntries(Object.entries(snapshots).map(([name, copy]) => [name, copy.data])))
    expect(cold.customer).toEqual({ id: customer.id, name: '合成备份客户', version: customer.version, fileId: customer.attachmentIds[0] })
    expect(Buffer.from(cold.originalBase64, 'base64')).toEqual(original)
  }
  finally {
    if (!closed)
      await storage.close()
  }
})
