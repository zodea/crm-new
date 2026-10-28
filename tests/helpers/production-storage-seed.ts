import type { ProductionStorageOptions } from '../../server/utils/production-storage'
import { createHash, randomUUID } from 'node:crypto'
import { constants, existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { createProductionStorage } from '../../server/utils/production-storage'
import { PRODUCTION_STORAGE_SCHEMA, PRODUCTION_STORAGE_UPGRADES, PRODUCTION_STORAGE_VERSION } from '../../server/utils/production-storage-schema'

const seedRoot = resolve('.tmp/vitest-fixtures/production-storage-seed')
const seeds = new Map<string, Promise<string>>()
let schemaKey: Promise<string> | null = null

/** 建库逻辑源码、结构与升级 SQL、Node 版本共同作键；任一变化即换新种子。 */
function currentSchemaKey() {
  schemaKey ??= readFile(resolve('server/utils/production-storage.ts'), 'utf8').then(source => createHash('sha256')
    .update(JSON.stringify([process.versions.node, PRODUCTION_STORAGE_VERSION, PRODUCTION_STORAGE_SCHEMA, PRODUCTION_STORAGE_UPGRADES, source]))
    .digest('hex'))
  return schemaKey
}

/** 由真实 createProductionStorage 在空目录首次建库、关闭后得到的同身份种子文件；各 worker 共享，先到者换名生效。 */
async function seedFile(options: ProductionStorageOptions): Promise<string> {
  const identity = createHash('sha256').update(JSON.stringify([await currentSchemaKey(), options.workspaceId, options.ownerId, options.purpose])).digest('hex')
  const path = join(seedRoot, `${identity}.sqlite`)
  if (existsSync(path))
    return path
  const staging = join(seedRoot, `staging-${process.pid}-${randomUUID()}`)
  await mkdir(staging, { recursive: true })
  try {
    const storage = createProductionStorage({ ...options, directory: staging })
    try {
      await storage.status()
    }
    finally { await storage.close() }
    if ((await readdir(staging)).some(name => name !== 'ruihang.sqlite'))
      throw new Error('种子库关闭后仍有 WAL 或附属文件，不能作为单文件种子')
    await rename(join(staging, 'ruihang.sqlite'), path).catch((cause) => {
      if (!existsSync(path))
        throw cause
    })
  }
  finally { await rm(staging, { recursive: true, force: true }) }
  return path
}

/**
 * 在新建的空数据目录放入同身份种子库后再打开，省去逐个领域建表与升级；
 * 打开时仍走已有库的完整校验（版本、参与者、结构、quick_check、外键）。与首次建库的差异只有元数据创建时间。
 * 验证建库、升级、结构或空目录行为的用例不得使用，须直接 createProductionStorage。
 */
export async function createSeededProductionStorage(options: ProductionStorageOptions) {
  const key = JSON.stringify([options.workspaceId, options.ownerId, options.purpose])
  let seed = seeds.get(key)
  if (!seed) {
    seed = seedFile(options)
    seeds.set(key, seed)
  }
  await copyFile(await seed, join(options.directory, 'ruihang.sqlite'), constants.COPYFILE_EXCL)
  return createProductionStorage(options)
}
