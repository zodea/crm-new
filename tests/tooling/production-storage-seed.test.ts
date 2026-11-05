import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { PRODUCTION_STORAGE_VERSION } from '../../server/utils/production-storage-schema'
import { createProductionSeedCache, createSeededProductionStorage, verifyProductionSeed } from '../helpers/production-storage-seed'
import { testTempRoot } from '../helpers/test-temp-root'

it('独立并发生成种子并冷核身份、结构及完整性，旧内容保留', async () => {
  const root = testTempRoot('seed-cache')
  const options = { directory: testTempRoot('unused'), workspaceId: 'seed-test-workspace', ownerId: 'seed-test-owner', purpose: 'verification' as const }
  await mkdir(root, { recursive: true })
  const unknown = join(root, 'unclassified.txt')
  await writeFile(unknown, '旧内容', { flag: 'wx' })
  let arrivals = 0
  let release!: () => void
  const bothMissed = new Promise<void>((resolve) => {
    release = resolve
  })
  const beforeCreate = async () => {
    if (++arrivals === 2)
      release()
    await bothMissed
  }
  const first = createProductionSeedCache(root, { beforeCreate })
  const second = createProductionSeedCache(root, { beforeCreate })
  const [one, two] = await Promise.all([first.seedFile(options), second.seedFile(options)])
  expect(one).not.toBe(two)
  verifyProductionSeed(one, options)
  verifyProductionSeed(two, options)
  expect(() => verifyProductionSeed(one, { ...options, ownerId: 'different-owner' })).toThrow('身份、用途或版本不一致')
  const damaged = join(root, 'damaged.sqlite')
  await writeFile(damaged, 'not a database', { flag: 'wx' })
  expect(() => verifyProductionSeed(damaged, options)).toThrow(/database/i)
  expect(await readFile(damaged, 'utf8')).toBe('not a database')
  expect(await readFile(unknown, 'utf8')).toBe('旧内容')
  const cached = await first.seedFile(options)
  expect([one, two]).toContain(cached)
})

it('种子库可供正式存储使用，已有目标拒绝覆盖并保留原字节', async () => {
  const options = { directory: testTempRoot('unused'), workspaceId: 'seed-test-workspace', ownerId: 'seed-test-owner', purpose: 'verification' as const }
  const target = testTempRoot('seed-target')
  await mkdir(target)
  const storage = await createSeededProductionStorage({ ...options, directory: target })
  try {
    expect(await storage.status()).toMatchObject({ schemaVersion: PRODUCTION_STORAGE_VERSION, purpose: 'verification' })
  }
  finally { await storage.close() }
  const before = await readFile(join(target, 'ruihang.sqlite'))
  await expect(createSeededProductionStorage({ ...options, directory: target })).rejects.toMatchObject({ code: 'EEXIST' })
  expect(await readFile(join(target, 'ruihang.sqlite'))).toEqual(before)
})

it('拒绝项目临时目录外的种子目标，原文件保持不变', async () => {
  const root = resolve('.')
  const cache = createProductionSeedCache(root)
  await expect(cache.seedFile({ directory: testTempRoot(), workspaceId: 'seed-outside-workspace', ownerId: 'seed-outside-owner', purpose: 'verification' })).rejects.toThrow('必须位于项目临时目录内')
})
