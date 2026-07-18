// 发票台账左树节点键与 query 预筛解析（specs §07：预筛走 query、不进页签身份）。
// 键形态：'__all' | '__own' | '__pending' | `p:id:<projectId>` | `p:name:<projectName>`。

export type ProjectGroupKey = `id:${string}` | `name:${string}`
export type ProjectTreeNodeKey = `p:${ProjectGroupKey}`

export function projectTreeNodeKey(key: ProjectGroupKey): ProjectTreeNodeKey {
  return `p:${key}`
}

export function projectGroupKeyFromNode(key: string): ProjectGroupKey | null {
  if (!key.startsWith('p:'))
    return null
  return key.slice(2) as ProjectGroupKey
}

/** `?project=<projectId>` → 树节点键；缺省/空返回 null（保持「全部」）。数组取首值。 */
export function ledgerNodeFromQuery(query: { project?: string | string[] | null }): ProjectTreeNodeKey | null {
  const raw = Array.isArray(query.project) ? query.project[0] : query.project
  if (!raw)
    return null
  return projectTreeNodeKey(`id:${raw}`)
}
