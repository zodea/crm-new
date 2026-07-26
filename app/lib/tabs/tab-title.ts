// 路由 → 标题/副标题（页签栏与顶栏共用）。详情页给「· 详情」后缀；
// 记录名（如具体项目/分供方名）由页面在拿到数据后经 store.setTitle 覆盖。
// subtitle 口径对齐 DC 设计稿 app.dc.html PAGE 词条（顶栏第二行）。

const RULES: { test: (p: string) => boolean, title: string, subtitle?: string }[] = [
  {
    test: p => /^\/export\/config\/[^/]+\/?$/.test(p),
    title: '导出配置',
    subtitle: '目录结构 · 命名规则 · 导出进度',
  },
  {
    test: p => /^\/import\/mapping\/[^/]+\/?$/.test(p),
    title: '导入映射',
    subtitle: '上传 · 映射 · 预览导入',
  },
  { test: p => p === '/', title: '首页', subtitle: '在建工程总览' },
  { test: p => p.startsWith('/project/target-cost/form'), title: '目标成本表单', subtitle: '版本基线 · 金额基准 · 附件' },
  { test: p => p.startsWith('/project/target-cost'), title: '目标成本', subtitle: '项目成本版本 · 对比基线' },
  { test: p => p.startsWith('/project/form'), title: '项目表单', subtitle: '项目信息 · 参建单位 · 风控立项' },
  { test: p => /^\/project\/[^/]+\/supplier\/import/.test(p), title: '分供方导入', subtitle: '批量建立合作关系' },
  { test: p => /^\/project\/[^/]+\/supplier\/[^/]+/.test(p), title: '项目分供方', subtitle: '合作关系 · 合同/请款/收票/付款 · 结算' },
  { test: p => /^\/project\/[^/]+/.test(p), title: '项目详情', subtitle: '经营驾驶舱 · 阶段 · 子表' },
  { test: p => p === '/project', title: '项目列表', subtitle: '项目管理' },
  { test: p => p.startsWith('/base/supplier/form'), title: '分供方表单', subtitle: '资料 · 开票信息 · 证照附件' },
  { test: p => /^\/base\/supplier\/[^/]+/.test(p), title: '分供方详情', subtitle: '资料 · 证照 · 跨项目汇总' },
  { test: p => p.startsWith('/base/supplier'), title: '分供方', subtitle: '资料管理 · 对账' },
  { test: p => p.startsWith('/base/customer/form'), title: '客户表单', subtitle: '甲方档案 · 开票资料' },
  { test: p => p.startsWith('/base/customer'), title: '客户', subtitle: '甲方档案 · 开票资料' },
  { test: p => p.startsWith('/base/crew/form'), title: '班组表单', subtitle: '核算配置 · 合作协议' },
  { test: p => /^\/base\/crew\/[^/]+/.test(p), title: '班组详情', subtitle: '基本信息 · 工人配置 · 分项单价' },
  { test: p => p.startsWith('/base/crew'), title: '班组管理', subtitle: '全局核算单元 · 跨项目复用' },
  { test: p => p.startsWith('/base/worker/form'), title: '工人表单', subtitle: '人员档案 · 项目分配 · 证书' },
  { test: p => /^\/base\/worker\/[^/]+/.test(p), title: '工人详情', subtitle: '档案 · 证书 · 亲属关联' },
  { test: p => p.startsWith('/base/worker'), title: '工人信息', subtitle: '人员管理' },
  { test: p => p.startsWith('/finance/invoice/factor'), title: '精确加法组合与税额计算', subtitle: '精确组合求解，支持价税分离和人民币大写' },
  { test: p => /^\/finance\/invoice\/[^/]+/.test(p), title: '发票编辑', subtitle: '单张校对 · 左原图右字段' },
  { test: p => p.startsWith('/finance/invoice'), title: '发票识别', subtitle: '资金管理 · 上传 · 校对 · 排版' },
  { test: p => p.startsWith('/finance/ledger'), title: '发票台账', subtitle: '资金管理 · 列表 / 打印 / 修改' },
  { test: p => p.startsWith('/finance'), title: '资金管理' },
  { test: p => p.startsWith('/contract/construction'), title: '施工合同', subtitle: '主合同管理 · 收入合同 · 四级对账' },
  { test: p => p.startsWith('/contract/subcontract'), title: '分包合同', subtitle: '分包及人工 · 劳务 / 专业分包' },
  { test: p => p.startsWith('/contract/material'), title: '材料采购合同', subtitle: '乙供材管理 · 采购合同台账' },
  { test: p => p.startsWith('/contract/company-expense'), title: '公司支出合同', subtitle: '公司层面 · 房租 / 软件 / 其他' },
  { test: p => p.startsWith('/contract/other-expense'), title: '其他支出合同', subtitle: '项目杂项支出 · 合同台账' },
  { test: p => p.startsWith('/contract/other-settlement'), title: '其他支出结算', subtitle: '项目级联 · 支出结算台账' },
  { test: p => p.startsWith('/contract/boq/import'), title: '清单拆表', subtitle: '上传识别格式 · 人工确认 · 结果预览' },
  { test: p => p.startsWith('/contract/boq'), title: '工程量清单', subtitle: '合同清单 · 变更单 · 月度报量' },
  { test: p => /^\/contract\/[^/]+/.test(p), title: '合同详情', subtitle: '四级对账 · 关联单据 · 文书' },
  { test: p => p.startsWith('/contract'), title: '主合同管理' },
  { test: p => /^\/subcontract\/quantity\/[^/]+\/[^/]+/.test(p), title: '户施工详情', subtitle: '工种 → 工序阶段 → 完成日期 · 三量与验收照片' },
  { test: p => p.startsWith('/subcontract/quantity'), title: '工程量管理', subtitle: '户型模板 · 责任指派 · 阶段完成' },
  { test: p => p.startsWith('/subcontract/payroll'), title: '工资核算', subtitle: '班组 × 项目 × 月份' },
  { test: p => p.startsWith('/subcontract/attendance'), title: '考勤', subtitle: '班组出勤记录' },
  { test: p => p.startsWith('/subcontract'), title: '分包及人工' },
  { test: p => p.startsWith('/material/delivery/archive/form'), title: '送货单归档表单', subtitle: '归属 · 单据字段 · 材料明细' },
  { test: p => /^\/material\/delivery\/archive\/[^/]+/.test(p), title: '送货单详情', subtitle: '归档信息 · 材料明细' },
  { test: p => p.startsWith('/material/delivery/archive'), title: '送货单归档库', subtitle: '乙供材管理 · 项目 → 分供方' },
  { test: p => p.startsWith('/material/delivery'), title: '送货单识别', subtitle: '上传 · OCR · 分区归档' },
  { test: p => p.startsWith('/material/requisition'), title: '下料单', subtitle: '乙供材要料计划 · 到货派生' },
  { test: p => p.startsWith('/material/arrival'), title: '材料到货', subtitle: '乙供材入库 · 明细聚合' },
  { test: p => p.startsWith('/material/use'), title: '材料领用', subtitle: '乙供材出库 · 库存校验' },
  { test: p => p.startsWith('/material/settlement'), title: '材料采购结算', subtitle: '采购合同 · 对账结算' },
  { test: p => p.startsWith('/material/stock-check'), title: '库存盘点', subtitle: '账面量 · 实盘量 · 盈亏生效' },
  { test: p => p.startsWith('/material/price'), title: '单价对比', subtitle: '材料价格分析' },
  { test: p => p.startsWith('/material'), title: '乙供材管理' },
  { test: p => p.startsWith('/owner-material/control'), title: '甲供材总控量', subtitle: '总控 · 到货 · 领用派生' },
  { test: p => p.startsWith('/owner-material/requisition'), title: '甲供材下料单', subtitle: '向甲方要料 · 计划量' },
  { test: p => p.startsWith('/owner-material/arrival'), title: '甲供材到货', subtitle: '甲供入库 · 总控校验' },
  { test: p => p.startsWith('/owner-material/use'), title: '甲供材领用', subtitle: '甲供出库 · 库存校验' },
  { test: p => p.startsWith('/owner-material/direct'), title: '甲供材直入直出', subtitle: '不入库 · 直供直用' },
  { test: p => p.startsWith('/dev/'), title: '开发验证', subtitle: 'KitUI 原语 · 组件走查' },
]

/** 由路由 path 推标题（不含 query）。未命中返回空串。 */
export function routeTitle(path: string): string {
  return RULES.find(r => r.test(path))?.title ?? ''
}

/** 由路由 path 推顶栏副标题。未命中返回空串（顶栏保留占位行高不跳动）。 */
export function routeSubtitle(path: string): string {
  return RULES.find(r => r.test(path))?.subtitle ?? ''
}
