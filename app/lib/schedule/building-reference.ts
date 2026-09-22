/** 显式名称或编码必须唯一指向本项目楼栋；歧义和空值均不构成覆盖证据。 */
export function resolveScheduleBuildingReference<T extends { id: string, code: string, name: string }>(buildings: readonly T[], reference: string | null | undefined): T | null {
  const value = reference?.trim()
  if (!value)
    return null
  const matches = buildings.filter(row => row.code === value || row.name === value)
  return matches.length === 1 ? matches[0]! : null
}
