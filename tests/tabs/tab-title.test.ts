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

describe('f1 主数据表单页签文案', () => {
  it.each([
    ['/base/supplier/form', '分供方表单'],
    ['/base/supplier/form/sup_1', '分供方表单'],
    ['/base/customer/form/customer_1', '客户表单'],
    ['/base/crew/form/crew_1', '班组表单'],
    ['/base/worker/form/worker_1', '工人表单'],
    ['/project/form/project_1', '项目表单'],
    ['/project/target-cost', '目标成本'],
    ['/project/target-cost/form/target_1', '目标成本表单'],
  ])('%s 不落入通用详情规则', (path, title) => {
    expect(routeTitle(path)).toBe(title)
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

describe('工程量矩阵页签文案', () => {
  it('标题与副标题使用责任、阶段分离后的领域语言', () => {
    expect(routeTitle('/subcontract/quantity')).toBe('工程量管理')
    expect(routeSubtitle('/subcontract/quantity')).toBe('户型模板 · 责任指派 · 阶段完成')
  })
})

describe('boq 页签文案', () => {
  it('清单工作区与专用拆表页不会落入通用合同详情', () => {
    expect(routeTitle('/contract/boq')).toBe('工程量清单')
    expect(routeSubtitle('/contract/boq')).toBe('合同清单 · 变更单 · 月度报量')
    expect(routeTitle('/contract/boq/import')).toBe('清单拆表')
  })
})

describe('f2 合同与支出结算页签文案', () => {
  it.each([
    ['/contract/construction/form/contract_1', '施工合同'],
    ['/contract/subcontract/form/contract_2', '分包合同'],
    ['/contract/material/form/contract_3', '材料采购合同'],
    ['/contract/company-expense/form/company_1', '公司支出合同'],
    ['/contract/other-expense/form/contract_4', '其他支出合同'],
    ['/contract/other-settlement/form/settlement_1', '其他支出结算'],
  ])('%s 保持对应业务标题', (path, title) => {
    expect(routeTitle(path)).toBe(title)
  })
})
