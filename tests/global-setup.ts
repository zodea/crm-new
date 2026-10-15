import type { TestProject } from 'vitest/node'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'
import { build, version as esbuildVersion } from 'esbuild'

/**
 * 冷进程与独立服务入口：每个入口都是 tests/helpers/<名称>.ts，经 runColdProcess/spawnColdProcess 以独立 Node 进程启动。
 * 新增入口须登记在此，否则启动时报“未预打包”。
 */
export const COLD_ENTRIES = [
  'production-auxiliary-cold',
  'production-boq-cold',
  'production-construction-cold',
  'production-construction-scope-cold',
  'production-payroll-a-cold',
  'production-payroll-cold-process',
  'production-payroll-history-cold-process',
  'production-process-library-server',
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
const cacheRoot = join(root, '.tmp', 'vitest-fixtures')
const bundleRoot = join(cacheRoot, 'cold-bundles')
const MIGRATIONS_ENTRY = 'app/lib/db/migrations.ts'

interface BundleManifest { key: string, inputs: Record<string, string>, migrationInputs: string[] }

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
async function hashFiles(paths: readonly string[]): Promise<Record<string, string> | null> {
  const entries = await Promise.all(paths.map(async (path) => {
    try {
      return [path, sha256(await readFile(join(root, path)))] as const
    }
    catch { return null }
  }))
  return entries.includes(null) ? null : Object.fromEntries(entries as Array<readonly [string, string]>)
}
const keyOf = (inputs: Record<string, string>, extra: string) => sha256(JSON.stringify([extra, Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b))]))
const bundleSalt = JSON.stringify({ esbuildVersion, node: process.versions.node, entries: COLD_ENTRIES, format: 'esm-v1' })

async function readManifest(): Promise<BundleManifest | null> {
  try {
    return JSON.parse(await readFile(join(bundleRoot, 'manifest.json'), 'utf8')) as BundleManifest
  }
  catch { return null }
}

/** 源码内容未变且产物齐全时复用；否则整批重打到新目录后原子换名，旧目录随后清理。 */
async function ensureColdBundles(): Promise<BundleManifest> {
  const previous = await readManifest()
  if (previous) {
    const current = await hashFiles(Object.keys(previous.inputs))
    const directory = join(bundleRoot, previous.key)
    if (current && keyOf(current, bundleSalt) === previous.key && COLD_ENTRIES.every(name => existsSync(join(directory, `${name}.mjs`))))
      return previous
  }
  await mkdir(bundleRoot, { recursive: true })
  const staging = join(bundleRoot, `staging-${process.pid}-${Date.now()}`)
  const result = await build({
    absWorkingDir: root,
    entryPoints: [
      ...COLD_ENTRIES.map(name => ({ in: `tests/helpers/${name}.ts`, out: name })),
      // 只取依赖清单作迁移快照的内容键；产物不执行。
      { in: MIGRATIONS_ENTRY, out: 'migrations-key' },
    ],
    outdir: staging,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    packages: 'external',
    alias: { '~': './app' },
    metafile: true,
    logLevel: 'silent',
  })
  const outputInputs = (out: string) => Object.keys(Object.entries(result.metafile.outputs).find(([path]) => path.endsWith(`/${out}.mjs`))![1].inputs)
  const inputs = (await hashFiles(Object.keys(result.metafile.inputs)))!
  const key = keyOf(inputs, bundleSalt)
  const manifest: BundleManifest = { key, inputs, migrationInputs: outputInputs('migrations-key') }
  const target = join(bundleRoot, key)
  // 并发的另一 project 可能已按同键换名完成；同键内容相同，保留先到者。
  await rename(staging, target).catch(async (cause) => {
    if (!existsSync(target))
      throw cause
    await rm(staging, { recursive: true, force: true })
  })
  await writeFile(join(bundleRoot, 'manifest.json'), JSON.stringify(manifest), 'utf8')
  for (const name of await readdir(bundleRoot)) {
    if (name !== key && name !== 'manifest.json' && !name.startsWith('staging-'))
      await rm(join(bundleRoot, name), { recursive: true, force: true })
  }
  return manifest
}

/** 迁移链源码、测试库驱动和 sql.js 版本共同作键；同键文件已存在时直接复用。 */
async function ensureMigratedSnapshot(manifest: BundleManifest): Promise<MigratedMemorySnapshot> {
  const sqlJsVersion = (JSON.parse(await readFile(join(root, 'node_modules/sql.js/package.json'), 'utf8')) as { version: string }).version
  const inputs = (await hashFiles([...manifest.migrationInputs, 'tests/helpers/memory-db.ts']))!
  const key = keyOf(inputs, JSON.stringify({ sqlJsVersion }))
  const directory = join(cacheRoot, 'migrated-memory')
  const path = join(directory, `${key}.sqlite`)
  const metaPath = join(directory, `${key}.json`)
  if (existsSync(path) && existsSync(metaPath))
    return { path, foreignKeys: (JSON.parse(await readFile(metaPath, 'utf8')) as { foreignKeys: number }).foreignKeys }
  const { migrateMemorySnapshot } = await import('./helpers/memory-db')
  const { bytes, foreignKeys } = await migrateMemorySnapshot()
  await mkdir(directory, { recursive: true })
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.tmp'))
      await rm(join(directory, name), { force: true })
  }
  const staging = `${path}.${process.pid}.tmp`
  await writeFile(staging, bytes)
  await rename(staging, path).catch(async (cause) => {
    if (!existsSync(path))
      throw cause
    await rm(staging, { force: true })
  })
  await writeFile(metaPath, JSON.stringify({ foreignKeys }), 'utf8')
  return { path, foreignKeys }
}

export default async function setup(project: TestProject) {
  const started = performance.now()
  const manifest = await ensureColdBundles()
  project.provide('coldBundleDirectory', join(bundleRoot, manifest.key))
  project.provide('migratedMemorySnapshot', await ensureMigratedSnapshot(manifest))
  if (process.env.VITEST_FIXTURE_TIMING)
    process.stdout.write(`[global-setup] ${project.name}: ${Math.round(performance.now() - started)}ms (${relative(root, bundleRoot)})\n`)
}
