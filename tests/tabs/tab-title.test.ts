import { readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { routeSubtitle, routeTitle } from '~/lib/tabs/tab-title'

function productionPageSamples(): Array<[file: string, routePath: string]> {
  const pagesRoot = resolve(process.cwd(), 'app/pages')
  const files: string[] = []

  function collect(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        if (absolutePath === resolve(pagesRoot, 'dev'))
          continue
        collect(absolutePath)
      }
      else if (entry.name.endsWith('.vue')) {
        files.push(absolutePath)
      }
    }
  }

  collect(pagesRoot)
  return files.map((file) => {
    const segments = relative(pagesRoot, file)
      .replaceAll('\\', '/')
      .replace(/\.vue$/, '')
      .split('/')
      .filter((segment, index, list) => segment !== 'index' || index !== list.length - 1)
      .map((segment) => {
        if (segment === '[kind]')
          return 'change'
        const dynamicName = segment.match(/^\[\[?([^\]]+)\]?\]$/)?.[1]
        return dynamicName ? `${dynamicName}_fixture` : segment
      })
    return [relative(pagesRoot, file).replaceAll('\\', '/'), `/${segments.join('/')}` || '/']
  })
}

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

describe('施工进度页签文案', () => {
  it.each([
    ['/schedule', '施工进度'],
    ['/schedule/project_1', '施工进度'],
    ['/schedule/new', '新建楼栋分组'],
    ['/schedule/project_1/bind/group_1', '绑定施工合同'],
  ])('%s 使用稳定业务标题，不把项目 id 或 new 当作标题', (path, title) => {
    expect(routeTitle(path)).toBe(title)
  })

  it('工作台与新建页分别说明排程和生成流程', () => {
    expect(routeSubtitle('/schedule')).toBe('WBS 排程 · 计划与实际进度')
    expect(routeSubtitle('/schedule/new')).toBe('选择楼栋 · 标准工序 · 生成排程')
    expect(routeSubtitle('/schedule/project_1/bind/group_1')).toBe('楼栋覆盖 · 分项映射 · 数量差异')
  })
})

describe('本轮反馈所涉页签标题', () => {
  it.each([
    ['/subcontract/quantity/template', '户型模板'],
    ['/subcontract/quantity/project_1/unit_1', '户施工详情'],
    ['/contract/boq/import', '清单拆表'],
    ['/contract/subcontract', '分包合同'],
    ['/material/delivery/archive/delivery_1', '送货单详情'],
    ['/material/price', '单价对比'],
  ])('%s 不显示“未命名”且不直接暴露动态 id', (path, title) => {
    expect(routeTitle(path)).toBe(title)
  })
})

describe('动态业务单据路由标题', () => {
  it.each([
    ['/owner/change', '甲方变洽签'],
    ['/owner/change/new', '甲方变洽签'],
    ['/owner/report/report_1', '甲方报量'],
    ['/owner/acceptance/acceptance_1', '竣工验收·保修'],
    ['/owner/final-settlement/settlement_1', '最终结算'],
    ['/owner/penalty/penalty_1', '甲方罚扣单'],
    ['/project/penalty', '项目罚扣'],
    ['/project/penalty/new', '项目罚扣'],
    ['/subcontract/change/change_1', '分包变洽签'],
    ['/subcontract/settlement/settlement_1', '分包结算'],
  ])('%s 由业务类型命名，不落入“项目详情/分包及人工”兜底', (path, title) => {
    expect(routeTitle(path)).toBe(title)
  })
})

describe('资金单据路由标题', () => {
  it.each([
    ['/finance/receipt', '收款登记'],
    ['/finance/receipt/receipt_1', '收款登记'],
    ['/finance/billing/new', '开票申请'],
    ['/finance/current/current_1', '往来收付'],
    ['/finance/reimbursement/reimbursement_1', '费用报销'],
    ['/finance/payment-management', '付款管理'],
    ['/finance/payment/payment_1', '付款申请'],
    ['/finance/records/record_1', '支付记录'],
  ])('%s 使用具体业务标题而不是笼统的“资金管理”', (path, title) => {
    expect(routeTitle(path)).toBe(title)
  })
})

describe('生产页面路由标题完整性', () => {
  it.each(productionPageSamples())('%s 的代表路由 %s 有稳定标题', (_file, path) => {
    const title = routeTitle(path)
    expect(title).not.toBe('')
    expect(title).not.toBe('未命名')
    expect(title).not.toContain('_fixture')
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
