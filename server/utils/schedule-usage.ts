import type { ProcessLibrarySummary, ProcessLibraryVersion } from '../../app/lib/schedule/process-library-contract'
import type { BusinessSession } from './business-session'
import { projectReadTestInstance } from './project-read-test-instance'
import { scheduleService } from './schedule-runtime'

/** 引用量是实时 WBS 投影，不写回不可变库版本。 */
export async function projectScheduleLibraryUsage<T extends ProcessLibrarySummary | ProcessLibraryVersion>(versions: T[], context: BusinessSession, sessionId?: string | null): Promise<T[]> {
  if (!['schedule:read', 'quantity:read', 'project:list:read', 'construction-contract:read', 'owner-document:read', 'process-library:read'].every(capability => context.capabilities.includes(capability)))
    return versions.map(row => ({ ...row, usageCount: null, usageProjects: [] }))
  const projects = projectReadTestInstance.facts(sessionId).rows.filter(row => row.dataOrigin === 'real')
  const counts = await Promise.all(projects.map(async project => ({
    project,
    usages: (await scheduleService.groupUsage({ projectId: project.id, origin: 'real', includeDemo: false }, sessionId)).groups,
  })))
  return versions.map((version) => {
    if (version.dataOrigin !== 'real')
      return version
    const usageProjects = counts.flatMap(({ project, usages }) => {
      const count = usages.find(row => row.libraryId === version.id)?.groupCount ?? 0
      return count ? [{ id: project.id, name: project.name, groupCount: count }] : []
    })
    return { ...version, usageCount: usageProjects.reduce((sum, row) => sum + row.groupCount, 0), usageProjects }
  })
}
