import type { TestProject } from 'vitest/node'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { build, version as esbuildVersion } from 'esbuild'
import { createFixtureCacheDirectory, createFixtureSourceHashReader, findFixtureCaches, publishFixtureCache } from './helpers/fixture-cache'

/**
 * 冷进程与独立服务入口：每个入口都是 tests/helpers/<名称>.ts，经 runColdProcess/spawnColdProcess 以独立 Node 进程启动。
 * 新增入口须登记在此，否则启动时报“未预打包”。
 */
export const COLD_ENTRIES = [
  'production-auxiliary-cold',
  'production-backup-paused-cold',
  'production-boq-cold',
  'production-construction-cold',
  'production-construction-scope-cold',
  'production-payroll-a-cold',
  'production-payroll-cold-process',
  'production-payroll-history-cold-process',
  'production-process-library-server',
  'production-project-cold',
  'production-quantity-cold-process',
  'production-quantity-import-cold-process',
  'production-subcontract-cold',
  'production-supplier-server',
  'production-target-cost-cold',
  'production-wbs-cold',
] as const
export type ColdEntry = typeof COLD_ENTRIES[number]

/** 默认全量迁移后的内存库字节文件及外键开关，见 tests/helpers/memory-db.ts */
export interface MigratedMemorySnapshot { path: string, foreignKeys: number }

declare module 'vitest' {
  export interface ProvidedContext {
    /** 冷进程打包产物目录（内容键），见 tests/helpers/cold-process.ts */
    coldBundleDirectory: string
    migratedMemorySnapshot: MigratedMemorySnapshot
  }
}

const root = resolve(import.meta.dirname, '..')
const tempRoot = join(root, '.tmp')
const cacheRoot = join(tempRoot, 'vitest-fixtures-v2')
const bundleRoot = join(cacheRoot, 'cold-bundles')
const MIGRATIONS_ENTRY = 'app/lib/db/migrations.ts'

interface BundleManifest { key: string, inputs: Record<string, string>, migrationInputs: string[], directory: string }

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
async function hashFiles(paths: readonly string[], readHash: (path: string) => Promise<string | null> = async (path) => {
  try {
    return sha256(await readFile(join(root, path)))
  }
  catch { return null }
}): Promise<Record<string, string> | null> {
  const entries = await Promise.all(paths.map(async (path) => {
    const hash = await readHash(path)
    return hash === null ? null : [path, hash] as const
  }))
  return entries.includes(null) ? null : Object.fromEntries(entries as Array<readonly [string, string]>)
}
const keyOf = (inputs: Record<string, string>, extra: string) => sha256(JSON.stringify([extra, Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b))]))
export const coldBundleOptions = {
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  alias: { '~': './app' },
} as const
export const coldBundleSalt = (options: unknown = coldBundleOptions) => JSON.stringify({ esbuildVersion, node: process.versions.node, entries: COLD_ENTRIES, options })
const bundleSalt = coldBundleSalt()

export async function checkCandidateSourceHashes(
  paths: readonly string[],
  expectedKey: string,
  salt: string,
  readCached: (path: string) => Promise<string | null>,
  readFresh?: (path: string) => Promise<string | null>,
): Promise<'different' | 'changed' | 'verified'> {
  const current = await hashFiles(paths, readCached)
  if (!current || keyOf(current, salt) !== expectedKey)
    return 'different'
  const verified = await hashFiles(paths, readFresh)
  return verified && keyOf(verified, salt) === expectedKey ? 'verified' : 'changed'
}

const bundleFiles = [...COLD_ENTRIES, 'migrations-key'].map(name => `${name}.mjs`)
/** 源码内容与产物摘要均吻合才复用；每次新构建写入独立目录，不删除旧缓存。 */
async function ensureColdBundles(): Promise<BundleManifest> {
  const caches = await findFixtureCaches<{ inputs: Record<string, string>, migrationInputs: string[] }>(bundleRoot, bundleFiles)
  const readCandidateHash = createFixtureSourceHashReader(path => readFile(join(root, path)))
  for (const { directory, manifest } of caches) {
    const previous = manifest.metadata
    if (!previous || typeof previous.inputs !== 'object' || !previous.inputs || !Array.isArray(previous.migrationInputs) || previous.migrationInputs.some(path => typeof path !== 'string'))
      continue
    const paths = Object.keys(previous.inputs)
    if (!/^[0-9a-f]{64}$/.test(manifest.key)
      || Object.values(previous.inputs).some(value => typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))
      || ![MIGRATIONS_ENTRY, ...COLD_ENTRIES.map(name => `tests/helpers/${name}.ts`)].every(path => paths.includes(path))
      || previous.migrationInputs.some(path => !paths.includes(path))) {
      continue
    }
    if ([...paths, ...previous.migrationInputs].some((path) => {
      const inside = relative(root, resolve(root, path))
      return !inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)
    })) {
      continue
    }
    const verification = await checkCandidateSourceHashes(paths, manifest.key, bundleSalt, readCandidateHash)
    if (verification === 'verified')
      return { key: manifest.key, ...previous, directory }
    if (verification === 'changed')
      break
  }
  const staging = await createFixtureCacheDirectory(bundleRoot)
  const result = await build({
    ...coldBundleOptions,
    absWorkingDir: root,
    entryPoints: [
      ...COLD_ENTRIES.map(name => ({ in: `tests/helpers/${name}.ts`, out: name })),
      // 只取依赖清单作迁移快照的内容键；产物不执行。
      { in: MIGRATIONS_ENTRY, out: 'migrations-key' },
    ],
    outdir: staging,
    metafile: true,
    logLevel: 'silent',
  })
  const outputInputs = (out: string) => Object.keys(Object.entries(result.metafile.outputs).find(([path]) => path.endsWith(`/${out}.mjs`))![1].inputs)
  const inputs = (await hashFiles(Object.keys(result.metafile.inputs)))!
  const key = keyOf(inputs, bundleSalt)
  const metadata = { inputs, migrationInputs: outputInputs('migrations-key') }
  await publishFixtureCache(staging, key, metadata, bundleFiles)
  return { key, ...metadata, directory: staging }
}

/** 迁移链源码、测试库驱动和 sql.js 版本共同作键；同键文件已存在时直接复用。 */
async function ensureMigratedSnapshot(manifest: BundleManifest): Promise<MigratedMemorySnapshot> {
  const sqlJsVersion = (JSON.parse(await readFile(join(root, 'node_modules/sql.js/package.json'), 'utf8')) as { version: string }).version
  const inputs = (await hashFiles([...manifest.migrationInputs, 'tests/helpers/memory-db.ts']))!
  const key = keyOf(inputs, JSON.stringify({ sqlJsVersion }))
  const directory = join(cacheRoot, 'migrated-memory')
  const caches = await findFixtureCaches<{ foreignKeys: number }>(directory, ['snapshot.sqlite'])
  const existing = caches.find(cache => cache.manifest.key === key && (cache.manifest.metadata?.foreignKeys === 0 || cache.manifest.metadata?.foreignKeys === 1))
  if (existing)
    return { path: join(existing.directory, 'snapshot.sqlite'), foreignKeys: existing.manifest.metadata.foreignKeys }
  const { migrateMemorySnapshot } = await import('./helpers/memory-db')
  const { bytes, foreignKeys } = await migrateMemorySnapshot()
  const staging = await createFixtureCacheDirectory(directory)
  const path = join(staging, 'snapshot.sqlite')
  await writeFile(path, bytes, { flag: 'wx' })
  await publishFixtureCache(staging, key, { foreignKeys }, ['snapshot.sqlite'])
  return { path, foreignKeys }
}

export default async function setup(project: TestProject) {
  const started = performance.now()
  for (const directory of [tempRoot, cacheRoot]) {
    await mkdir(directory, { recursive: true })
    const stat = await lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(`测试缓存路径不是普通目录：${directory}`)
  }
  const manifest = await ensureColdBundles()
  project.provide('coldBundleDirectory', manifest.directory)
  project.provide('migratedMemorySnapshot', await ensureMigratedSnapshot(manifest))
  if (process.env.VITEST_FIXTURE_TIMING)
    process.stdout.write(`[global-setup] ${project.name}: ${Math.round(performance.now() - started)}ms (${relative(root, bundleRoot)})\n`)
}
