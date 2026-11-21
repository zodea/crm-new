import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createLocalBackup } from '../../server/utils/production-backup-package'
import { backupProtection, backupShouldRun, retainedBackupIds } from '../../server/utils/production-backup-policy'
import { pruneProductionBackups } from '../../server/utils/production-backup-retention'
import { createProductionStorage } from '../../server/utils/production-storage'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

describe('备份策略', () => {
  describe('备份保护与调度使用实际数据时点', () => {
    const now = Date.parse('2026-09-22T12:00:00Z')
    it.each([
      { case: '{ configured: true, capturedAt: \'2026-09-21T11:59:59Z\', lastFailure: null } / now', input: { configured: true, capturedAt: '2026-09-21T11:59:59Z', lastFailure: null }, argument2: now, expected: 'expired' },
      { case: '{ configured: true, capturedAt: \'2026-09-21T12:00:01Z\', lastFailure: null } / now', input: { configured: true, capturedAt: '2026-09-21T12:00:01Z', lastFailure: null }, argument2: now, expected: 'protected' },
      { case: '{ configured: true, capturedAt: \'2026-09-23T12:00:00Z\', lastFailure: null } / now', input: { configured: true, capturedAt: '2026-09-23T12:00:00Z', lastFailure: null }, argument2: now, expected: 'clock-invalid' },
      { case: '{ configured: true, capturedAt: \'2026-09-22T11:00:00Z\', lastFailure: \'介质不可用\' } / now', input: { configured: true, capturedAt: '2026-09-22T11:00:00Z', lastFailure: '介质不可用' }, argument2: now, expected: 'failed' },
    ])('复制旧包不会刷新保护时点，超过24小时和未来时间不能显示已保护 / backupProtection：$case', ({ input, argument2, expected }) => {
      expect(backupProtection(input, argument2)).toBe(expected)
    })
    it.each([
      { case: '{ configured: true, running: false, lastCapturedAt: null, lastAttemptAt: null, intervalHours: 12 } / now', input: { configured: true, running: false, lastCapturedAt: null, lastAttemptAt: null, intervalHours: 12 }, argument2: now, expected: true },
      { case: '{ configured: true, running: false, lastCapturedAt: \'2026-09-22T01:00:00Z\', lastAttemptAt: \'2026-09-22T01:00:00Z\', intervalHo', input: { configured: true, running: false, lastCapturedAt: '2026-09-22T01:00:00Z', lastAttemptAt: '2026-09-22T01:00:00Z', intervalHours: 12 }, argument2: now, expected: false },
      { case: '{ configured: true, running: false, lastCapturedAt: \'2026-09-21T23:00:00Z\', lastAttemptAt: \'2026-09-21T23:00:00Z\', intervalHo', input: { configured: true, running: false, lastCapturedAt: '2026-09-21T23:00:00Z', lastAttemptAt: '2026-09-21T23:00:00Z', intervalHours: 12 }, argument2: now, expected: true },
      { case: '{ configured: true, running: false, lastCapturedAt: null, lastAttemptAt: \'2026-09-22T11:59:00Z\', intervalHours: 12 } / now', input: { configured: true, running: false, lastCapturedAt: null, lastAttemptAt: '2026-09-22T11:59:00Z', intervalHours: 12 }, argument2: now, expected: false },
      { case: '{ configured: true, running: true, lastCapturedAt: null, lastAttemptAt: null, intervalHours: 12 } / now', input: { configured: true, running: true, lastCapturedAt: null, lastAttemptAt: null, intervalHours: 12 }, argument2: now, expected: false },
    ])('每12小时备份，首次或睡眠错过时补跑，失败重试不形成忙循环 / backupShouldRun：$case', ({ input, argument2, expected }) => {
      expect(backupShouldRun(input, argument2)).toBe(expected)
    })
    it('按上海日/月保留已校验包，始终留下最后一份，不把日份数误当运行次数', () => {
      const packages = [
        { id: 'newest', capturedAt: '2026-09-22T10:00:00Z' },
        { id: 'same-day', capturedAt: '2026-09-22T01:00:00Z' },
        { id: 'previous-day', capturedAt: '2026-09-21T01:00:00Z' },
        { id: 'previous-month', capturedAt: '2026-08-31T01:00:00Z' },
        { id: 'older-month', capturedAt: '2026-07-30T01:00:00Z' },
      ]
      expect([...retainedBackupIds(packages, 2, 2)].sort()).toEqual(['newest', 'previous-day', 'previous-month'])
      expect([...retainedBackupIds(packages, 0, 0)]).toEqual(['newest'])
    })
  })
})

describe('备份留存', () => {
  afterAll(cleanupTestTempRoot)

  it('只清理有成功回执且完整的到期包，保留最后成功、基线及混入未知文件的包', async () => {
    const base = testTempRoot('legacy-test-artifacts/issue-451-tests')
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
      await expect(access(join(target, packages[2]!.id))).rejects.toMatchObject({ code: 'ENOENT' })

      for (const index of [0, 1, 3])
        expect((await readFile(join(target, packages[index]!.id, 'data.sqlite'))).length).toBeGreaterThan(0)
      expect(await readFile(join(target, packages[1]!.id, 'unclassified.txt'), 'utf8')).toBe('keep this file')
    }
    finally { await storage.close() }
  })
})
