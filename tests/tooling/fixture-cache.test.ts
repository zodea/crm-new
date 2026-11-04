import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { checkCandidateSourceHashes, coldBundleOptions, coldBundleSalt } from '../global-setup'
import { createFixtureCacheDirectory, createFixtureSourceHashReader, findFixtureCaches, publishFixtureCache } from '../helpers/fixture-cache'
import { testTempRoot } from '../helpers/test-temp-root'

const simulatedLinks = vi.hoisted(() => new Set<string>())
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      const stat = await actual.lstat(...args)
      if (!simulatedLinks.has(String(args[0])))
        return stat
      return new Proxy(stat, {
        get(target, property, receiver) {
          return property === 'isSymbolicLink' ? () => true : Reflect.get(target, property, receiver)
        },
      })
    },
  }
})

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

it('超过并发上限的目录全部校验并按目录顺序返回，多次读取互不干扰', async () => {
  const root = testTempRoot('fixture-cache-many')
  const directories = await Promise.all(Array.from({ length: 20 }, () => createFixtureCacheDirectory(root)))
  await Promise.all(directories.map(async (directory, index) => {
    await writeFile(join(directory, 'result.bin'), `内容${index}`, { flag: 'wx' })
    await publishFixtureCache(directory, `key-${index}`, { index }, ['result.bin'])
  }))
  const expected = (await readdir(root)).map(name => join(root, name))
  const [first, second] = await Promise.all([findFixtureCaches(root, ['result.bin']), findFixtureCaches(root, ['result.bin'])])
  expect(first.map(entry => entry.directory)).toEqual(expected)
  expect(second).toEqual(first)
})

it('拒绝目录 junction 并保留真实来源', async () => {
  const root = testTempRoot('fixture-cache-directory-link')
  const valid = await createFixtureCacheDirectory(root)
  await writeFile(join(valid, 'result.bin'), '合成来源', { flag: 'wx' })
  await publishFixtureCache(valid, 'valid', {}, ['result.bin'])
  await symlink(valid, join(root, 'run-00000000-0000-0000-0000-000000000000'), 'junction')
  expect((await findFixtureCaches(root, ['result.bin'])).map(entry => entry.directory)).toEqual([valid])
  await expect(findFixtureCaches(join(root, 'run-00000000-0000-0000-0000-000000000000'), ['result.bin'])).rejects.toThrow('不是普通目录')
  expect(await readFile(join(valid, 'result.bin'), 'utf8')).toBe('合成来源')
})

it('拒绝清单和产物的链接状态，且不影响普通文件', async () => {
  const root = testTempRoot('fixture-cache-simulated-links')
  const valid = await createFixtureCacheDirectory(root)
  const manifestLink = await createFixtureCacheDirectory(root)
  const resultLink = await createFixtureCacheDirectory(root)
  for (const directory of [valid, manifestLink, resultLink]) {
    await writeFile(join(directory, 'result.bin'), '合成来源', { flag: 'wx' })
    await publishFixtureCache(directory, directory, {}, ['result.bin'])
  }
  simulatedLinks.add(join(manifestLink, 'manifest.json'))
  simulatedLinks.add(join(resultLink, 'result.bin'))
  expect((await findFixtureCaches(root, ['result.bin'])).map(entry => entry.directory)).toEqual([valid])
  expect(await readFile(join(valid, 'result.bin'), 'utf8')).toBe('合成来源')
})

it('文件符号链接可用时真实拒绝链接，无权限时明确报告创建失败', async (context) => {
  const root = testTempRoot('fixture-cache-file-links')
  const valid = await createFixtureCacheDirectory(root)
  await writeFile(join(valid, 'result.bin'), '合成来源', { flag: 'wx' })
  await publishFixtureCache(valid, 'valid', {}, ['result.bin'])
  const manifestLink = await createFixtureCacheDirectory(root)
  await writeFile(join(manifestLink, 'result.bin'), '合成来源', { flag: 'wx' })
  const resultLink = await createFixtureCacheDirectory(root)
  await writeFile(join(resultLink, 'manifest.json'), await readFile(join(valid, 'manifest.json')), { flag: 'wx' })
  let unsupported: string | undefined
  try {
    await symlink(join(valid, 'manifest.json'), join(manifestLink, 'manifest.json'), 'file')
    await symlink(join(valid, 'result.bin'), join(resultLink, 'result.bin'), 'file')
  }
  catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? ''))
      throw error
    unsupported = (error as NodeJS.ErrnoException).code
  }
  if (unsupported) {
    expect(['EPERM', 'EACCES', 'ENOSYS']).toContain(unsupported)
    await context.annotate(`当前 Windows 环境不能创建文件符号链接：${unsupported}；链接状态通过独立测试验证`)
    return
  }
  expect((await findFixtureCaches(root, ['result.bin'])).map(entry => entry.directory)).toEqual([valid])
  expect(await readFile(join(valid, 'result.bin'), 'utf8')).toBe('合成来源')
})

it('构建选项参与内容键，选项变化不能命中旧产物', async () => {
  const originalSalt = coldBundleSalt()
  const sourceHash = createHash('sha256').update('原内容').digest('hex')
  const expectedKey = createHash('sha256').update(JSON.stringify([originalSalt, [['source.ts', sourceHash]]])).digest('hex')
  const read = async () => sourceHash
  expect(await checkCandidateSourceHashes(['source.ts'], expectedKey, originalSalt, read, read)).toBe('verified')
  for (const changed of [
    { ...coldBundleOptions, target: 'node20' },
    { ...coldBundleOptions, format: 'cjs' },
    { ...coldBundleOptions, packages: 'bundle' },
    { ...coldBundleOptions, alias: { '~': './other-app' } },
    { ...coldBundleOptions, outExtension: { '.js': '.js' } },
    { ...coldBundleOptions, bundle: false },
    { ...coldBundleOptions, platform: 'browser' },
  ]) {
    expect(await checkCandidateSourceHashes(['source.ts'], expectedKey, coldBundleSalt(changed), read, read)).toBe('different')
  }
})

it('同次候选只读取一次来源，命中前重读发现来源变化时拒绝复用', async () => {
  let source = '原内容'
  let reads = 0
  const bytes = async () => {
    reads++
    return Buffer.from(source)
  }
  const cached = createFixtureSourceHashReader(bytes)
  const oldHash = createHash('sha256').update(source).digest('hex')
  const key = createHash('sha256').update(JSON.stringify(['salt', [['source.ts', oldHash]]])).digest('hex')
  expect(await Promise.all([cached('source.ts'), cached('source.ts')])).toEqual([oldHash, oldHash])
  expect(reads).toBe(1)
  source = '中途修改'
  const fresh = async () => createHash('sha256').update(await bytes()).digest('hex')
  expect(await checkCandidateSourceHashes(['source.ts'], key, 'salt', cached, fresh)).toBe('changed')
  expect(reads).toBe(2)
  source = '原内容'
  expect(await checkCandidateSourceHashes(['source.ts'], key, 'salt', cached, fresh)).toBe('verified')
  expect(reads).toBe(3)
  expect(await checkCandidateSourceHashes(['source.ts'], 'other-key', 'salt', cached, fresh)).toBe('different')
  expect(reads).toBe(3)
})
