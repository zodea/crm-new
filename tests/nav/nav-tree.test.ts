import { describe, expect, it } from 'vitest'
import { activeNavKey, ensureActiveGroupOpen, filterNavTree, NAV_TREE } from '~/lib/nav/nav-tree'

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

  it('本地状态恢复后仍展开当前叶子所属分组', () => {
    expect(ensureActiveGroupOpen([], 'project')).toEqual(['g-project'])
    expect(ensureActiveGroupOpen(['g-project'], 'project')).toEqual(['g-project'])
  })

  it('送货单归档库入口可导航，列表与详情都点亮归档库', () => {
    expect(leaves().find(item => item.key === 'deliveryArchive')?.to).toBe('/material/delivery/archive')
    expect(activeNavKey('/material/delivery/archive')).toBe('deliveryArchive')
    expect(activeNavKey('/material/delivery/archive/del_1')).toBe('deliveryArchive')
    expect(activeNavKey('/material/delivery')).toBe('delivery')
  })
})
