import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createFixtureCacheDirectory, findFixtureCaches, publishFixtureCache } from '../helpers/fixture-cache'
import { testTempRoot } from '../helpers/test-temp-root'

it('并发缓存独立发布；旧文件和未分类内容保持，同键冲突不冒认可复用', async () => {
  const root = testTempRoot('fixture-cache')
  await mkdir(join(root, 'old-cache'), { recursive: true })
  await writeFile(join(root, 'old-cache', 'legacy-snapshot.bin'), '旧快照字节')
  await writeFile(join(root, 'unclassified.txt'), '不可清理')
  const [first, second] = await Promise.all([createFixtureCacheDirectory(root), createFixtureCacheDirectory(root)])
  expect(first).not.toBe(second)
  await Promise.all([first, second].map(async (directory) => {
    await writeFile(join(directory, 'result.bin'), '相同内容', { flag: 'wx' })
    await publishFixtureCache(directory, 'content-key', { version: 1 }, ['result.bin'])
  }))
  const caches = await findFixtureCaches<{ version: number }>(root, ['result.bin'])
  expect(caches.map(cache => cache.directory).sort()).toEqual([first, second].sort())
  await expect(publishFixtureCache(first, 'content-key', { version: 1 }, ['result.bin'])).rejects.toMatchObject({ code: 'EEXIST' })
  const third = await createFixtureCacheDirectory(root)
  await writeFile(join(third, 'result.bin'), '冲突内容', { flag: 'wx' })
  await publishFixtureCache(third, 'content-key', { version: 1 }, ['result.bin'])
  await expect(findFixtureCaches(root, ['result.bin'])).rejects.toThrow('同键内容冲突')
  expect(await readFile(join(first, 'result.bin'), 'utf8')).toBe('相同内容')
  expect(await readFile(join(third, 'result.bin'), 'utf8')).toBe('冲突内容')
  expect(await readFile(join(root, 'old-cache', 'legacy-snapshot.bin'), 'utf8')).toBe('旧快照字节')
  expect(await readFile(join(root, 'unclassified.txt'), 'utf8')).toBe('不可清理')
})

it('缓存产物被篡改或清单不完整时不当作命中', async () => {
  const root = testTempRoot('fixture-cache-invalid')
  const valid = await createFixtureCacheDirectory(root)
  await writeFile(join(valid, 'result.bin'), '原内容', { flag: 'wx' })
  await publishFixtureCache(valid, 'key', {}, ['result.bin'])
  const incomplete = await createFixtureCacheDirectory(root)
  await writeFile(join(incomplete, 'result.bin'), '未发布', { flag: 'wx' })
  await writeFile(join(valid, 'result.bin'), '已篡改')
  expect(await findFixtureCaches(root, ['result.bin'])).toEqual([])
  expect(await readFile(join(incomplete, 'result.bin'), 'utf8')).toBe('未发布')
})
