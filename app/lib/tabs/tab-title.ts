// 路由 → 标题（页签栏与顶栏共用）。详情页给「· 详情」后缀；
// 记录名（如具体项目/分供方名）由页面在拿到数据后经 store.setTitle 覆盖。

const RULES: { test: (p: string) => boolean, title: string }[] = [
  { test: p => p === '/', title: '首页' },
  { test: p => /^\/project\/[^/]+\/supplier\/import/.test(p), title: '分供方导入' },
  { test: p => /^\/project\/[^/]+\/supplier\/[^/]+/.test(p), title: '项目分供方' },
  { test: p => /^\/project\/[^/]+/.test(p), title: '项目详情' },
  { test: p => p === '/project', title: '项目列表' },
  { test: p => /^\/base\/supplier\/[^/]+/.test(p), title: '分供方详情' },
  { test: p => p.startsWith('/base/supplier'), title: '分供方' },
  { test: p => /^\/base\/crew\/[^/]+/.test(p), title: '班组详情' },
  { test: p => p.startsWith('/base/crew'), title: '班组管理' },
  { test: p => /^\/base\/worker\/[^/]+/.test(p), title: '工人详情' },
  { test: p => p.startsWith('/base/worker'), title: '工人信息' },
  { test: p => p.startsWith('/finance/invoice/factor'), title: '开票因子' },
  { test: p => p.startsWith('/finance/invoice'), title: '发票识别' },
  { test: p => p.startsWith('/finance'), title: '资金管理' },
  { test: p => p.startsWith('/contract/construction'), title: '施工合同' },
  { test: p => p.startsWith('/contract/subcontract'), title: '分包合同' },
  { test: p => p.startsWith('/contract/material'), title: '材料采购合同' },
  { test: p => /^\/contract\/[^/]+/.test(p), title: '合同详情' },
  { test: p => p.startsWith('/contract'), title: '主合同管理' },
  { test: p => p.startsWith('/subcontract/quantity'), title: '工程量管理' },
  { test: p => p.startsWith('/subcontract/payroll'), title: '工资核算' },
  { test: p => p.startsWith('/subcontract/attendance'), title: '考勤' },
  { test: p => p.startsWith('/subcontract'), title: '分包及人工' },
  { test: p => p.startsWith('/material/delivery'), title: '送货单识别' },
  { test: p => p.startsWith('/material/price'), title: '单价对比' },
  { test: p => p.startsWith('/material'), title: '乙供材管理' },
  { test: p => p.startsWith('/dev/'), title: '开发验证' },
]

/** 由路由 path 推标题（不含 query）。未命中返回空串。 */
export function routeTitle(path: string): string {
  return RULES.find(r => r.test(path))?.title ?? ''
}
