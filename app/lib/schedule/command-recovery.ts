import type { CommandRecoveryDescriptor } from '../forms/command-recovery'

// This list permits original-number lookup; it never grants permission to write a binding.
export const SCHEDULE_COMMAND_RECOVERY_ACTIONS: readonly string[] = ['create-group', 'update-task', 'update-floors', 'update-dependency', 'save-task-plan', 'reschedule-task', 'remove-dependency', 'restore-dependency', 'set-baseline', 'add-task', 'remove-task', 'undo', 'bind-contract']
export function scheduleRecoveryTarget(fullPath: string): Pick<CommandRecoveryDescriptor, 'family' | 'targetId'> | null {
  try {
    if (!fullPath.startsWith('/') || fullPath.startsWith('//') || fullPath.includes('\\'))
      return null
    const url = new URL(fullPath, 'https://ruihang.invalid')
    if (url.searchParams.getAll('origin').length > 1 || (url.searchParams.has('origin') && url.searchParams.get('origin') !== 'real') || url.searchParams.getAll('project').length > 1)
      return null
    const path = /^\/schedule\/([^/]+)(?:\/bind\/[^/]+)?$/.exec(url.pathname)
    const encoded = ['/schedule', '/schedule/new'].includes(url.pathname) ? url.searchParams.get('project') : path && !['new', 'process-library'].includes(path[1]!) ? path[1] : null
    const id = encoded ? decodeURIComponent(encoded) : null
    if (!id || !id.trim() || /[\s/\\?#]/.test(id) || [...id].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
      return null
    if (path && !['new', 'process-library'].includes(path[1]!) && url.searchParams.has('project') && url.searchParams.get('project') !== id)
      return null
    return { family: 'schedule', targetId: id }
  }
  catch { return null }
}
export function scheduleVersionBasis(version: string): { revision: number, projectId: string, project: string, buildings: Record<string, string> } | null {
  try {
    if (!version.startsWith('wbs-v1:'))
      return null
    const basis = JSON.parse(atob(version.slice(7).replace(/-/g, '+').replace(/_/g, '/')))
    return Number.isSafeInteger(basis.revision) && basis.revision >= 0 && typeof basis.projectId === 'string' && typeof basis.project === 'string' && basis.buildings && typeof basis.buildings === 'object' && !Array.isArray(basis.buildings) ? basis : null
  }
  catch { return null }
}
