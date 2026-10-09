import type { CommandRecoveryDescriptor, RecoveryStorage } from '../forms/command-recovery'
import { commandRecoveryKey, createCommandRecoveryStorage } from '../forms/command-recovery'

const buckets = ['payroll-a-central-pending-v1', 'payroll-c1-central-pending-v1', 'payroll-c2-central-pending-v1', 'payroll-a-fees-central-pending-v1', 'payroll-a-rounding-central-pending-v1', 'payroll-attendance-central-pending-v1', 'payroll-daywork-central-pending-v1', 'payroll-adjustments-central-pending-v1', 'payroll-hollow-central-pending-v1', 'payroll-batch-central-pending-v1', 'payroll-numbering-pending-v1'] as const

/** Pure startup lookup: descriptors preserve the route; no request, resolution or input restoration. */
export function readPayrollStartupDescriptors(fullPath: string, actor: { workspaceId: string, actorId: string }, storage: Pick<RecoveryStorage, 'getItem'> = globalThis.sessionStorage): Array<{ descriptor: CommandRecoveryDescriptor, storageKey: string, entryKey: string }> {
  if (!fullPath.startsWith('/') || fullPath.startsWith('//') || fullPath.includes('\\'))
    return []
  const url = new URL(fullPath, 'https://ruihang.invalid')
  if (['origin', 'project', 'projectId', 'month', 'draftKey', 'format', 'planId'].some(key => url.searchParams.getAll(key).length > 1) || (url.searchParams.has('project') && url.searchParams.has('projectId') && url.searchParams.get('project') !== url.searchParams.get('projectId')))
    return []
  if (url.searchParams.has('origin') && url.searchParams.get('origin') !== 'real')
    return []
  const path = url.pathname
  if (!/^\/subcontract\/(?:payroll(?:\/|$)|attendance$|daywork(?:\/|$))/.test(path))
    return []
  const result: Array<{ descriptor: CommandRecoveryDescriptor, storageKey: string, entryKey: string }> = []
  for (const storageKey of buckets) {
    const encoded = storage.getItem(storageKey)
    if (encoded === null)
      continue
    let entries: Record<string, unknown>
    try {
      entries = JSON.parse(encoded)
    }
    catch { throw new Error('工资原编号存储损坏，请保全原记录。') }
    if (!entries || typeof entries !== 'object' || Array.isArray(entries))
      throw new Error('工资原编号存储结构无效，请保全原记录。')
    for (const [entryKey, raw] of Object.entries(entries)) {
      if (!raw || typeof raw !== 'object' || !('family' in raw))
        continue // Existing legacy body records remain with their original per-format recovery reader.
      const candidate = raw as CommandRecoveryDescriptor
      const descriptor = createCommandRecoveryStorage(() => ({ getItem: () => JSON.stringify(raw), setItem() {}, removeItem() {} })).read(commandRecoveryKey(candidate))
      if (!descriptor || descriptor.family !== 'payroll' || descriptor.scopeId !== encodeURIComponent(entryKey))
        throw new Error('工资原编号的稳定上下文无法核实，请保全原记录。')
      if (descriptor.workspaceId !== actor.workspaceId || descriptor.actorId !== actor.actorId)
        continue
      const attendance = storageKey.includes('attendance')
      const daywork = storageKey.includes('daywork')
      const adjustments = storageKey.includes('adjustments')
      const numbering = storageKey.includes('numbering')
      const batch = storageKey.includes('batch')
      if (!attendance && !daywork && !adjustments && !numbering && !batch && /^\/subcontract\/payroll\/(?:adjustments|payments|issue|workbooks|sources|roster)(?:\/|$)/.test(path))
        continue
      if ((attendance && path !== '/subcontract/attendance') || (daywork && !path.startsWith('/subcontract/daywork')) || (adjustments && !/^\/subcontract\/payroll\/(?:adjustments|payments)(?:\/|$)/.test(path)) || (numbering && !path.startsWith('/subcontract/payroll/issue/')) || (batch && path !== '/subcontract/payroll'))
        continue
      if (!attendance && !daywork && !adjustments && !numbering && !batch && !path.startsWith('/subcontract/payroll'))
        continue
      const match = /^\/subcontract\/(?:payroll\/(?:form\/|issue\/|adjustments\/form\/|adjustments\/|payments\/)?|daywork\/form\/)([^/]+)$/.exec(path)
      const routeId = match?.[1] && !['new', 'config', 'payments', 'adjustments', 'workbooks', 'sources', 'roster'].includes(match[1]) ? decodeURIComponent(match[1]) : null
      if (routeId && descriptor.targetId !== routeId)
        continue
      const isNew = /\/new$/.test(path)
      if (isNew && descriptor.targetId !== null)
        continue
      if (path === '/subcontract/payroll/config' || isNew) {
        const format = url.searchParams.get('format') ?? 'A'
        if ((storageKey.includes('-c1-') && format !== 'C1') || (storageKey.includes('-c2-') && format !== 'C2') || (storageKey.includes('-a-') && format !== 'A'))
          continue
      }
      let scope: unknown[]
      try {
        scope = JSON.parse(entryKey)
      }
      catch { throw new Error('工资原编号定位键无法解释，请保全原记录。') }
      if ((path === '/subcontract/payroll/config' && (descriptor.targetId !== null || !scope.some(value => value && typeof value === 'object'))) || (batch && url.searchParams.has('planId') && (scope[3] !== 'plan' || scope[4] !== url.searchParams.get('planId'))))
        continue
      const config = scope.find(value => value && typeof value === 'object') as { projectId?: string, month?: string, leaderWorkerId?: string, scope?: { projectId?: string } } | undefined
      const projectId = attendance ? scope[4] : numbering ? scope[2] : adjustments ? scope[3] : config?.projectId ?? config?.scope?.projectId
      const month = attendance && typeof scope[6] === 'string' ? String(scope[6]).slice(0, 7) : config?.month
      const routeProject = url.searchParams.get('project') ?? url.searchParams.get('projectId')
      if ((routeProject !== null && projectId !== undefined && projectId !== routeProject) || (url.searchParams.has('month') && month !== undefined && month !== url.searchParams.get('month')) || (url.searchParams.has('draftKey') && descriptor.targetId === null && !entryKey.includes(JSON.stringify(url.searchParams.get('draftKey')))))
        continue
      result.push({ descriptor, storageKey, entryKey })
    }
  }
  return result
}
