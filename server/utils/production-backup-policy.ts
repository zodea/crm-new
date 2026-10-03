const HOUR_MS = 60 * 60 * 1000
const RETRY_MS = 15 * 60 * 1000
export type BackupProtection = 'unconfigured' | 'never' | 'clock-invalid' | 'expired' | 'failed' | 'protected'

export function backupProtection(state: { configured: boolean, capturedAt: string | null, lastFailure: string | null }, now: number): BackupProtection {
  if (!state.configured)
    return 'unconfigured'
  if (state.lastFailure)
    return 'failed'
  if (!state.capturedAt)
    return 'never'
  const captured = Date.parse(state.capturedAt)
  if (!Number.isFinite(captured) || captured > now)
    return 'clock-invalid'
  return now - captured > 24 * HOUR_MS ? 'expired' : 'protected'
}

export function backupShouldRun(state: { configured: boolean, running: boolean, lastCapturedAt: string | null, lastAttemptAt: string | null, intervalHours: number }, now: number): boolean {
  if (!state.configured || state.running || !Number.isFinite(now))
    return false
  if (state.lastAttemptAt) {
    const attempted = Date.parse(state.lastAttemptAt)
    if (!Number.isFinite(attempted) || now - attempted < RETRY_MS)
      return false
  }
  if (!state.lastCapturedAt)
    return true
  const captured = Date.parse(state.lastCapturedAt)
  return Number.isFinite(captured) && captured <= now && now - captured >= state.intervalHours * HOUR_MS
}

/** Only already verified, tool-owned packages enter retention; unknown files never enter this function. */
export function retainedBackupIds(packages: readonly { id: string, capturedAt: string }[], daily: number, monthly: number): Set<string> {
  const ordered = [...packages].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || a.id.localeCompare(b.id))
  const keep = new Set<string>()
  const days = new Set<string>()
  const months = new Set<string>()
  for (const item of ordered) {
    const date = new Date(Date.parse(item.capturedAt) + 8 * HOUR_MS).toISOString().slice(0, 10)
    const month = date.slice(0, 7)
    if (!keep.size || (!days.has(date) && days.size < daily) || (!months.has(month) && months.size < monthly))
      keep.add(item.id)
    days.add(date)
    months.add(month)
  }
  return keep
}
