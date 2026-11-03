import type { ProductionStorageOptions } from '../../server/utils/production-storage'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { createProductionStorage, verifyProductionStorageSchema } from '../../server/utils/production-storage'
import { PRODUCTION_STORAGE_SCHEMA, PRODUCTION_STORAGE_UPGRADES, PRODUCTION_STORAGE_VERSION, productionParticipantVersions } from '../../server/utils/production-storage-schema'
import { createFixtureCacheDirectory, findFixtureCaches, publishFixtureCache } from './fixture-cache'

const seedRoot = resolve('.tmp/vitest-fixtures-v2/production-storage-seed')
let schemaKey: Promise<string> | null = null

function currentSchemaKey() {
  schemaKey ??= readFile(resolve('server/utils/production-storage.ts'), 'utf8').then(source => createHash('sha256')
    .update(JSON.stringify([process.versions.node, PRODUCTION_STORAGE_VERSION, PRODUCTION_STORAGE_SCHEMA, PRODUCTION_STORAGE_UPGRADES, source]))
    .digest('hex'))
  return schemaKey
}

async function safeCacheRoot(root: string) {
  const project = resolve('.')
  const temp = resolve(project, '.tmp')
  const suffix = relative(temp, root)
  if (!suffix || suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix))
    throw new Error('测试种子目录必须位于项目临时目录内')
  let current = temp
  for (const part of ['', ...suffix.split(sep)]) {
    if (part)
      current = join(current, part)
    await mkdir(current).catch((cause) => {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST')
        throw cause
    })
    const stat = await lstat(current)
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('测试种子目录不能经过重解析点')
  }
}

/** Read-only cold verification before using any cached seed. */
export function verifyProductionSeed(path: string, options: ProductionStorageOptions): void {
  const db = new DatabaseSync(path, { readOnly: true, enableForeignKeyConstraints: true, defensive: true })
  try {
    const meta = db.prepare('SELECT schema_version,workspace_id,owner_id,purpose FROM production_metadata WHERE singleton=1').get()
    if (!meta || meta.schema_version !== PRODUCTION_STORAGE_VERSION || meta.workspace_id !== options.workspaceId || meta.owner_id !== options.ownerId || meta.purpose !== options.purpose)
      throw new Error('测试种子库身份、用途或版本不一致')
    const versions = productionParticipantVersions(PRODUCTION_STORAGE_VERSION)
    const participants = db.prepare('SELECT domain,schema_version FROM production_participants').all()
    if (participants.length !== Object.keys(versions).length || participants.some(row => typeof row.domain !== 'string' || versions[row.domain] !== row.schema_version))
      throw new Error('测试种子库参与者不完整')
    verifyProductionStorageSchema(db, PRODUCTION_STORAGE_VERSION)
    if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('测试种子库完整性检查失败')
  }
  finally { db.close() }
}

/** Each producer owns a distinct directory; failed and concurrent results remain untouched. */
export function createProductionSeedCache(cacheRoot = seedRoot, hooks: { beforeCreate?: () => Promise<void> } = {}) {
  const pending = new Map<string, Promise<string>>()
  async function produce(options: ProductionStorageOptions, identity: string): Promise<string> {
    const identityRoot = join(cacheRoot, identity)
    await safeCacheRoot(identityRoot)
    const caches = await findFixtureCaches<{ identity: string }>(identityRoot, ['ruihang.sqlite'])
    for (const cache of caches) {
      if (cache.manifest.metadata?.identity !== identity || cache.manifest.key !== `${identity}-${cache.manifest.files['ruihang.sqlite']}`)
        continue
      const path = join(cache.directory, 'ruihang.sqlite')
      verifyProductionSeed(path, options)
      return path
    }
    await hooks.beforeCreate?.()
    const staging = await createFixtureCacheDirectory(identityRoot)
    const storage = createProductionStorage({ ...options, directory: staging })
    try {
      await storage.status()
    }
    finally { await storage.close() }
    if ((await readdir(staging)).some(name => name !== 'ruihang.sqlite'))
      throw new Error('种子库关闭后仍有 WAL 或附属文件，已保留原目录')
    const path = join(staging, 'ruihang.sqlite')
    verifyProductionSeed(path, options)
    const digest = createHash('sha256').update(await readFile(path)).digest('hex')
    await publishFixtureCache(staging, `${identity}-${digest}`, { identity }, ['ruihang.sqlite'])
    return path
  }
  return {
    async seedFile(options: ProductionStorageOptions): Promise<string> {
      const identity = createHash('sha256').update(JSON.stringify([await currentSchemaKey(), options.workspaceId, options.ownerId, options.purpose])).digest('hex')
      let task = pending.get(identity)
      if (!task) {
        task = produce(options, identity)
        pending.set(identity, task)
      }
      try {
        return await task
      }
      finally {
        if (pending.get(identity) === task)
          pending.delete(identity)
      }
    },
  }
}

const cache = createProductionSeedCache()

export async function createSeededProductionStorage(options: ProductionStorageOptions) {
  const seed = await cache.seedFile(options)
  await copyFile(seed, join(options.directory, 'ruihang.sqlite'), constants.COPYFILE_EXCL)
  const storage = createProductionStorage(options)
  try {
    await storage.status()
    return storage
  }
  catch (cause) {
    await storage.close()
    throw cause
  }
}
