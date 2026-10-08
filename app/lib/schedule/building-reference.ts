/** 显式名称或编码必须唯一指向本项目楼栋；歧义和空值均不构成覆盖证据。 */
export function resolveScheduleBuildingReference<T extends { id: string, code: string, name: string }>(buildings: readonly T[], reference: string | null | undefined): T | null {
  const value = reference?.trim()
  if (!value)
    return null
  const matches = buildings.filter(row => row.code === value || row.name === value)
  return matches.length === 1 ? matches[0]! : null
}

/** A declared stable identity remains the only target after labels change; it never falls back to another master. */
export function resolveScheduleBoqBuildingReference<T extends { id: string, code: string, name: string }>(buildings: readonly T[], line: { building?: string | null, declaredBuildingId?: string | null }): T | null {
  if (line.declaredBuildingId)
    return buildings.find(row => row.id === line.declaredBuildingId) ?? null
  return resolveScheduleBuildingReference(buildings, line.building)
}
