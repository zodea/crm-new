import { describe, expect, it } from 'vitest'
import { filterNavTree, NAV_TREE } from '~/lib/nav/nav-tree'

function leaves() {
  return NAV_TREE.flatMap(node => node.type === 'group' ? node.items : [node])
}

describe('侧栏导航树', () => {
  it('每个导航叶子都有可静态提取的 Lucide 图标', () => {
    expect(leaves().every(item => item.icon.startsWith('i-lucide-'))).toBe(true)
  })

  it('按名称或副提示搜索，并保留待建项的不可导航状态', () => {
    const byLabel = filterNavTree(NAV_TREE, '付款申请')
    const payment = byLabel.flatMap(node => node.type === 'group' ? node.items : [node])
    expect(payment).toHaveLength(1)
    expect(payment[0]).toMatchObject({ key: 'payApply' })
    expect(payment[0]).not.toHaveProperty('to')

    const byHint = filterNavTree(NAV_TREE, 'OCR 处理区')
    const delivery = byHint.flatMap(node => node.type === 'group' ? node.items : [node])
    expect(delivery.map(item => item.key)).toEqual(['delivery'])
  })

  it('空关键词返回完整导航树', () => {
    expect(filterNavTree(NAV_TREE, '')).toBe(NAV_TREE)
  })
})
