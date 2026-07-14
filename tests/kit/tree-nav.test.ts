import type { TreeNode } from '~/lib/kit/tree-nav'
import { describe, expect, it } from 'vitest'
import { flattenTree, isNodeActive, resolveNodeCount } from '~/lib/kit/tree-nav'

const ledgerTree: TreeNode[] = [
  {
    key: 'all',
    label: '全部',
    children: [
      { key: 'p1', label: '合和新城', count: 12 },
      { key: 'p2', label: '锦绣江南', count: 8 },
      { key: 'unassigned', label: '未归项目', tone: 'warn', count: 3 },
      { key: 'personal', label: '个人开支', tone: 'brand', count: 5 },
    ],
  },
]

describe('节点计数聚合：resolveNodeCount', () => {
  it('显式 count 优先（含 0）', () => {
    expect(resolveNodeCount({ key: 'x', label: 'x', count: 7 })).toBe(7)
    expect(resolveNodeCount({ key: 'x', label: 'x', count: 0 })).toBe(0)
  })

  it('父节点缺省 count → 聚合子节点之和（台账「全部」口径）', () => {
    expect(resolveNodeCount(ledgerTree[0])).toBe(12 + 8 + 3 + 5)
  })

  it('递归聚合多层子节点', () => {
    const node: TreeNode = {
      key: 'root',
      label: 'root',
      children: [
        { key: 'a', label: 'a', children: [{ key: 'a1', label: 'a1', count: 2 }, { key: 'a2', label: 'a2', count: 3 }] },
        { key: 'b', label: 'b', count: 4 },
      ],
    }
    expect(resolveNodeCount(node)).toBe(2 + 3 + 4)
  })

  it('无 count 无子节点 → null（不显示角标）', () => {
    expect(resolveNodeCount({ key: 'x', label: 'x' })).toBeNull()
  })
})

describe('选中判定：isNodeActive', () => {
  it('key 相等且 active 非空 → true', () => {
    expect(isNodeActive('p1', 'p1')).toBe(true)
  })

  it('不相等或 active 空 → false', () => {
    expect(isNodeActive('p1', 'p2')).toBe(false)
    expect(isNodeActive('p1', null)).toBe(false)
    expect(isNodeActive('p1', undefined)).toBe(false)
  })
})

describe('扁平化：flattenTree', () => {
  it('深度优先展开含子节点', () => {
    const keys = flattenTree(ledgerTree).map(n => n.key)
    expect(keys).toEqual(['all', 'p1', 'p2', 'unassigned', 'personal'])
  })
})
