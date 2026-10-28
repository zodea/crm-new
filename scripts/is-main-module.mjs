import { realpathSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/** Compare real paths so junctions and drive aliases cannot silently skip a CLI. */
export function isMainModule(moduleUrl, entryPath = process.argv[1]) {
  if (!entryPath)
    return false
  const entry = realpathSync(entryPath)
  const module = realpathSync(fileURLToPath(moduleUrl))
  return process.platform === 'win32' ? entry.toLowerCase() === module.toLowerCase() : entry === module
}
