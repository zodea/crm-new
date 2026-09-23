import type { ProductionBackupConfig } from './production-backup-config'
import { rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { existingBackupDirectory, readBackupPackage } from './production-backup-package'
import { retainedBackupIds } from './production-backup-policy'

/** A configured product retention policy: only complete packages with successful durable receipts qualify. */
export async function pruneProductionBackups(root: string, candidates: readonly { id: string, capturedAt: string }[], protectedIds: ReadonlySet<string>, policy: Pick<ProductionBackupConfig, 'dailyCopies' | 'monthlyCopies'>) {
  const directory = await existingBackupDirectory(root)
  const keep = retainedBackupIds(candidates, policy.dailyCopies, policy.monthlyCopies)
  const removed: string[] = []
  const skipped: string[] = []
  for (const item of candidates) {
    if (keep.has(item.id) || protectedIds.has(item.id))
      continue
    try {
      const pack = await readBackupPackage(directory, item.id)
      if (pack.capturedAt !== item.capturedAt) {
        skipped.push(item.id)
        continue
      }
      // No recursive deletion, no glob discovery, no unknown contents and no links.
      await unlink(join(directory, item.id, 'data.sqlite'))
      await unlink(join(directory, item.id, 'manifest.json'))
      await rmdir(join(directory, item.id))
      removed.push(item.id)
    }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT')
        skipped.push(item.id)
    }
  }
  return { removed, skipped }
}
