import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createLocalBackup } from '../../server/utils/production-backup-package'
import { pruneProductionBackups } from '../../server/utils/production-backup-retention'
import { createProductionStorage } from '../../server/utils/production-storage'

it.each(Array.from([0, 1, 3]).map(input1 => ({ input1 })))('只清理有成功回执且完整的到期包，保留最后成功/基线及混入未知文件的包：输入案例 %#', async ({ input1: index }) => {
  const base = resolve('.tmp/legacy-test-artifacts/issue-451-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/retention-`)
  const source = join(directory, 'source')
  const target = join(directory, 'target')
  await mkdir(source)
  await mkdir(target)
  const storage = createProductionStorage({ directory: source, workspaceId: 'retention-workspace', ownerId: 'retention-owner', purpose: 'verification' })
  try {
    const packages = []
    for (const day of ['01', '02', '03', '04']) {
      const id = `backup-${randomUUID()}`
      const pack = await createLocalBackup(storage, target, id, () => `2026-09-${day}T00:00:00.000Z`)
      packages.push({ id, capturedAt: pack.capturedAt })
    }
    await writeFile(join(target, packages[1]!.id, 'unclassified.txt'), 'keep this file')
    const result = await pruneProductionBackups(target, packages, new Set([packages[0]!.id]), { dailyCopies: 1, monthlyCopies: 1 })
    expect(result.removed).toEqual([packages[2]!.id])
    expect(result.skipped).toEqual([packages[1]!.id])
    await expect(access(join(target, packages[2]!.id))).rejects.toThrow()

    expect((await readFile(join(target, packages[index]!.id, 'data.sqlite'))).length).toBeGreaterThan(0)
    expect(await readFile(join(target, packages[1]!.id, 'unclassified.txt'), 'utf8')).toBe('keep this file')
  }
  finally { await storage.close() }
})
