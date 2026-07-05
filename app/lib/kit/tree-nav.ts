// KitAtoms TreeNav 左树导航的纯逻辑（类型 + 计数聚合 + 选中判定）。
// 抽到此处便于 node 环境 vitest 直接断言（不依赖 DOM）。
// 业务背景：发票台账左树「全部」张数 = 各项目张数之和 —— 即父节点未显式给
// count 时按子节点聚合，避免手工重复维护父层计数（PRD #47 台账左树口径）。

export interface TreeNode {
  key: string
  label: string
  /** 图标（完整 UnoCSS icon class，如 'i-lucide-folder'）；缺省时组件按层级给默认图标。 */
  icon?: string
  /** 数量角标；缺省且有子节点时由 resolveNodeCount 聚合子节点。 */
  count?: number | null
  /** 语义色：warn（未归属告警）/ brand（个人开支等特殊节点）。 */
  tone?: 'warn' | 'brand'
  children?: TreeNode[]
}

/**
 * 节点显示的计数：
 * - 显式 count 优先（含 0）；
 * - 缺省且有子节点 → 递归聚合子节点 count 之和；
 * - 都没有 → null（不显示角标）。
 */
export function resolveNodeCount(node: TreeNode): number | null {
  if (node.count != null)
    return node.count
  if (node.children?.length) {
    return node.children.reduce((acc, c) => acc + (resolveNodeCount(c) ?? 0), 0)
  }
  return null
}

/** 某 key 是否为当前选中节点（active 为空则恒 false）。 */
export function isNodeActive(key: string, active: string | null | undefined): boolean {
  return active != null && key === active
}

/** 深度优先扁平化（含子节点），便于查找 / 统计总节点数。 */
export function flattenTree(items: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = []
  for (const it of items) {
    out.push(it)
    if (it.children?.length)
      out.push(...flattenTree(it.children))
  }
  return out
}
