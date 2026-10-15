import { describe, expect, it } from 'vitest'
import { activeNavKey, NAV_TREE } from '~/lib/nav/nav-tree'
import { routeTitle } from '~/lib/tabs/tab-title'

describe('核心身份迁移入口', () => {
  it('从设置侧栏进入独立迁移页并保持激活态与页签标题', () => {
    const item = NAV_TREE
      .flatMap(node => node.type === 'group' ? node.items : [node])
      .find(candidate => candidate.key === 'dataMigration')

    expect(item).toMatchObject({
      label: '本地数据迁移',
      to: '/settings/data-migration',
    })
    expect(activeNavKey('/settings/data-migration')).toBe('dataMigration')
    expect(routeTitle('/settings/data-migration')).toBe('本地数据迁移')
  })
})
