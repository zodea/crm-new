import type { DataOriginDTO } from '../../types/read-model'

export function normalizedDeliveryAlias(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]+/gu, '')
}

interface Project { id: string, name: string, dataOrigin: DataOriginDTO }
interface ConfirmedDelivery { projectId: string, rawSiteText: string, dataOrigin?: DataOriginDTO, archived: boolean, currentValuesConfirmed: boolean }

/** 只复用可证明的人工作业结果；独立旧项目别名表仍须其自身受控迁移。 */
export function confirmedDeliveryProjectCandidates(projects: readonly Project[], records: readonly ConfirmedDelivery[], origin: DataOriginDTO) {
  const currentProjects = projects.filter(project => project.dataOrigin === origin)
  const projectIds = new Set(currentProjects.map(project => project.id))
  const aliases = new Map<string, { text: string, projects: Set<string> }>()
  for (const record of records) {
    if (record.dataOrigin !== origin || !record.archived || !record.currentValuesConfirmed || !projectIds.has(record.projectId))
      continue
    const text = record.rawSiteText.trim()
    const key = normalizedDeliveryAlias(text)
    if (key.length < 2)
      continue
    const entry = aliases.get(key) ?? { text, projects: new Set<string>() }
    entry.projects.add(record.projectId)
    aliases.set(key, entry)
  }
  return currentProjects.map(project => ({ id: project.id, name: project.name, aliases: [...aliases.values()].filter(alias => alias.projects.size === 1 && alias.projects.has(project.id)).map(alias => alias.text) }))
}
