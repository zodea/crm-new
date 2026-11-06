import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { createProductionBackupService } from '../../server/utils/production-backup-service'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { createProductionStorage } from '../../server/utils/production-storage'

function inside(parent: string, child: string) {
  const path = relative(parent, child)
  return !!path && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

async function ordinaryDirectory(path: string) {
  const stat = await lstat(path)
  const actual = await realpath(path)
  const same = process.platform === 'win32' ? actual.toLowerCase() === resolve(path).toLowerCase() : actual === resolve(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || !same)
    throw new Error('合成备份测试目录不是普通目录')
}

async function ordinaryFile(path: string) {
  const stat = await lstat(path)
  const actual = await realpath(path)
  const same = process.platform === 'win32' ? actual.toLowerCase() === resolve(path).toLowerCase() : actual === resolve(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !same)
    throw new Error('合成备份文件不是独立普通文件')
}

async function main() {
  const [taskArg, baseArg, packageId, customerId, fileId] = process.argv.slice(2)
  if (!taskArg || !baseArg || !customerId || !fileId || !packageId || !/^backup-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(packageId))
    throw new Error('冷进程缺少合成目录或备份编号')
  const temp = resolve('.tmp')
  const runs = join(temp, 'vitest-runs')
  const task = resolve(taskArg)
  const base = resolve(baseArg)
  if (!isAbsolute(taskArg) || !isAbsolute(baseArg) || !inside(runs, task) || !inside(task, base))
    throw new Error('冷进程只允许读取本次合成测试目录')
  const roots = Object.fromEntries(['source', 'staging', 'primary', 'offline', 'restore'].map(name => [name, join(base, name)]))
  for (const path of [temp, runs, task, base, ...Object.values(roots)])
    await ordinaryDirectory(path!)
  await ordinaryFile(join(roots.source!, 'ruihang.sqlite'))
  const identity = { workspaceId: 'paused-backup-workspace', actorId: 'paused-backup-owner' }
  const storage = createProductionStorage({ directory: roots.source!, workspaceId: identity.workspaceId, ownerId: identity.actorId, purpose: 'verification' })
  const config = { stagingDirectory: roots.staging!, primaryDirectory: roots.primary!, offlineDirectory: roots.offline!, restoreDirectory: roots.restore!, intervalHours: 12, dailyCopies: 1, monthlyCopies: 1 }
  const service = createProductionBackupService(storage, config, () => '2026-09-23T00:00:00.000Z')
  const session = () => ({ ...identity, capabilities: [] })
  const restoredDirectory = join(roots.restore!, 'paused-restore-first')
  await ordinaryDirectory(restoredDirectory)
  await ordinaryFile(join(restoredDirectory, 'ruihang.sqlite'))
  const restored = createProductionStorage({ directory: restoredDirectory, workspaceId: identity.workspaceId, ownerId: identity.actorId, purpose: 'verification' })
  try {
    const status = await service.status(session)
    const replay = await service.execute({ action: 'backup', commandId: 'paused-backup-first', sourceBackupId: null }, session)
    const copies: Record<string, string> = {}
    for (const name of ['staging', 'primary', 'offline']) {
      const directory = join(roots[name]!, packageId)
      await ordinaryDirectory(directory)
      const file = join(directory, 'data.sqlite')
      await ordinaryFile(file)
      copies[name] = createHash('sha256').update(await readFile(file)).digest('hex')
    }
    const customerSession = () => ({ ...identity, capabilities: ['customer:list:read', 'customer:write'] })
    const customers = createProductionCustomerService(restored)
    const form = await customers.form(customerId, customerSession)
    const original = await customers.file(customerId, fileId, customerSession)
    process.stdout.write(JSON.stringify({ pid: process.pid, latest: status.latest, baseline: status.baseline, replay, copies, customer: { id: form.draft.id, name: form.draft.name, version: form.version, fileId }, originalBase64: Buffer.from(original.bytes).toString('base64') }))
  }
  finally {
    await restored.close()
    await storage.close()
  }
}

void main().catch((cause) => {
  process.stderr.write(String(cause))
  process.exitCode = 1
})
