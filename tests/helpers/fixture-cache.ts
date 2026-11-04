import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface FixtureCacheManifest<T> {
  key: string
  metadata: T
  files: Record<string, string>
}

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const safeName = (name: string) => /^[a-z0-9][\w.-]*$/i.test(name)

/** Reuse source digests only during one candidate search; callers recheck the winner. */
export function createFixtureSourceHashReader(read: (path: string) => Promise<Uint8Array>) {
  const hashes = new Map<string, Promise<string | null>>()
  return (path: string): Promise<string | null> => {
    let result = hashes.get(path)
    if (!result) {
      result = read(path).then(digest, () => null)
      hashes.set(path, result)
    }
    return result
  }
}

async function plainDirectory(path: string) {
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`测试缓存路径不是普通目录：${path}`)
}

/** No cache entry is replaced or deleted; concurrent producers each own a fresh directory. */
export async function createFixtureCacheDirectory(root: string): Promise<string> {
  await mkdir(root, { recursive: true })
  await plainDirectory(root)
  const directory = join(root, `run-${randomUUID()}`)
  await mkdir(directory)
  return directory
}

export async function publishFixtureCache<T>(directory: string, key: string, metadata: T, names: readonly string[]): Promise<void> {
  await plainDirectory(directory)
  const files: Record<string, string> = {}
  for (const name of names) {
    if (!safeName(name) || name === 'manifest.json')
      throw new Error('测试缓存文件名无效')
    const file = join(directory, name)
    const stat = await lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('测试缓存产物不是普通文件')
    files[name] = digest(await readFile(file))
  }
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ key, metadata, files }), { flag: 'wx' })
}

/** Incomplete, malformed and altered entries are never returned as cache hits. */
export async function findFixtureCaches<T>(root: string, names: readonly string[]): Promise<Array<{ directory: string, manifest: FixtureCacheManifest<T> }>> {
  let entries: string[]
  try {
    await plainDirectory(root)
    entries = await readdir(root)
  }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT')
      return []
    throw cause
  }
  const results: Array<{ directory: string, manifest: FixtureCacheManifest<T> } | undefined> = Array.from({ length: entries.length })
  let next = 0
  async function inspectEntries() {
    while (next < entries.length) {
      const index = next++
      const entry = entries[index]!
      if (!/^run-[0-9a-f-]{36}$/.test(entry))
        continue
      const directory = join(root, entry)
      try {
        await plainDirectory(directory)
        const manifestPath = join(directory, 'manifest.json')
        const stat = await lstat(manifestPath)
        if (!stat.isFile() || stat.isSymbolicLink())
          continue
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as FixtureCacheManifest<T>
        if (!manifest || typeof manifest.key !== 'string' || !manifest.files || Object.keys(manifest.files).length !== names.length)
          continue
        let valid = true
        for (const name of names) {
          if (!safeName(name) || typeof manifest.files[name] !== 'string') {
            valid = false
            break
          }
          const file = join(directory, name)
          const fileStat = await lstat(file)
          if (!fileStat.isFile() || fileStat.isSymbolicLink() || digest(await readFile(file)) !== manifest.files[name]) {
            valid = false
            break
          }
        }
        if (valid)
          results[index] = { directory, manifest }
      }
      catch { /* Incomplete or untrusted entries stay untouched. */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, entries.length) }, () => inspectEntries()))
  const found = results.filter((result): result is { directory: string, manifest: FixtureCacheManifest<T> } => result !== undefined)
  const seen = new Map<string, string>()
  for (const { manifest } of found) {
    const evidence = JSON.stringify([manifest.metadata, names.map(name => manifest.files[name])])
    const previous = seen.get(manifest.key)
    if (previous !== undefined && previous !== evidence)
      throw new Error(`测试缓存同键内容冲突，已保留全部文件：${manifest.key}`)
    seen.set(manifest.key, evidence)
  }
  return found
}
