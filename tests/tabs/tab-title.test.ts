import { describe, expect, it } from 'vitest'
import { routeSubtitle, routeTitle } from '~/lib/tabs/tab-title'

describe('导出配置页签文案', () => {
  it('动态工作流路由使用统一页签标题', () => {
    expect(routeTitle('/export/config/export-1')).toBe('导出配置')
  })

  it('顶栏副标题概括配置与执行阶段', () => {
    expect(routeSubtitle('/export/config/export-1')).toBe('目录结构 · 命名规则 · 导出进度')
  })
})

describe('导入映射页签文案', () => {
  it('实体路由使用统一页签标题', () => {
    expect(routeTitle('/import/mapping/demo-supplier')).toBe('导入映射')
  })

  it('顶栏副标题概括三步向导', () => {
    expect(routeSubtitle('/import/mapping/demo-supplier')).toBe('上传 · 映射 · 预览导入')
  })
})
