// 侧栏导航树 —— 单一权威源：DC 设计稿批A 锁定版 10 组 IA（app.dc.html _buildSidebar NAV）。
// mark=中文单字方块（品牌签名）、hint=副提示；to 缺省 = 页面尚未实装（侧栏灰显「待建」，
// 对应 #87 roadmap 后续域 / #91 批C-E，实装后回填 to 即上线入口）。

export interface NavLeaf {
  key: string
  /** 单字方块字符 */
  mark: string
  label: string
  /** 副提示（展开态显示在 label 下方） */
  hint: string
  /** 已实装页面路由；缺省 = 待建占位 */
  to?: string
}

export interface NavGroup {
  type: 'group'
  key: string
  label: string
  /** UnoCSS lucide 图标类名 */
  icon: string
  items: NavLeaf[]
}

export type NavNode = ({ type: 'item' } & NavLeaf) | NavGroup

export const NAV_TREE: NavNode[] = [
  { type: 'item', key: 'home', mark: '首', label: '首页', hint: '总览', to: '/' },
  { type: 'group', key: 'g-project', label: '项目信息', icon: 'i-lucide-building', items: [
    { key: 'project', mark: '项', label: '项目列表', hint: '工期进度', to: '/project' },
    { key: 'schedule', mark: '进', label: '施工进度', hint: '排程 · 甘特' },
    { key: 'targetCost', mark: '标', label: '目标成本', hint: '预算基准' },
  ] },
  { type: 'group', key: 'g-main', label: '主合同管理', icon: 'i-lucide-file-signature', items: [
    { key: 'conContract', mark: '合', label: '施工合同', hint: '收入合同', to: '/contract/construction' },
    { key: 'ownerChange', mark: '洽', label: '甲方变洽签', hint: '变更·签证' },
    { key: 'ownerReport', mark: '报', label: '甲方报量', hint: '月度报量' },
    { key: 'acceptance', mark: '验', label: '竣工验收·保修', hint: '阶段流转' },
    { key: 'finalSettle', mark: '终', label: '最终结算', hint: '与甲方结算' },
    { key: 'ownerPenalty', mark: '罚', label: '甲方罚扣单', hint: '对我方罚扣' },
    { key: 'boqImport', mark: '拆', label: '清单拆表', hint: '合同清单→表格' },
  ] },
  { type: 'group', key: 'g-sub', label: '分包及人工', icon: 'i-lucide-hard-hat', items: [
    { key: 'subContract', mark: '分', label: '分包合同', hint: '劳务·专业', to: '/contract/subcontract' },
    { key: 'subChange', mark: '洽', label: '分包变洽签', hint: '增项·签证' },
    { key: 'subSettle', mark: '结', label: '分包结算', hint: '结算台账' },
    { key: 'projPenalty', mark: '扣', label: '项目罚扣', hint: '罚款·抵扣' },
    { key: 'quantity', mark: '量', label: '工程量管理', hint: '矩阵可视化', to: '/subcontract/quantity' },
    { key: 'boqList', mark: '单', label: '工程量清单', hint: '分项·三量' },
    { key: 'payroll', mark: '资', label: '工资核算', hint: '核算发放', to: '/subcontract/payroll' },
    { key: 'wageSlip', mark: '款', label: '工资进度款', hint: '铺贴核算工具' },
  ] },
  { type: 'group', key: 'g-material', label: '乙供材管理', icon: 'i-lucide-package', items: [
    { key: 'matContract', mark: '采', label: '材料采购合同', hint: '采购台账', to: '/contract/material' },
    { key: 'matRequisition', mark: '料', label: '下料单', hint: '要料计划' },
    { key: 'matArrival', mark: '到', label: '材料到货', hint: '入库' },
    { key: 'matUse', mark: '领', label: '材料领用', hint: '出库' },
    { key: 'matSettle', mark: '算', label: '材料采购结算', hint: '对账结算' },
    { key: 'stockCheck', mark: '盘', label: '库存盘点', hint: '盘点生效' },
    { key: 'delivery', mark: '送', label: '送货单识别', hint: 'OCR 处理区', to: '/material/delivery' },
    { key: 'deliveryArchive', mark: '档', label: '送货单归档库', hint: '项目→分供方' },
    { key: 'price', mark: '价', label: '单价对比', hint: '材料价格分析', to: '/material/price' },
  ] },
  { type: 'group', key: 'g-owner-material', label: '甲供材管理', icon: 'i-lucide-boxes', items: [
    { key: 'omTotal', mark: '控', label: '甲供材总控量', hint: '总控/到货/领用' },
    { key: 'omRequisition', mark: '料', label: '甲供材下料单', hint: '要料计划' },
    { key: 'omArrival', mark: '到', label: '甲供材到货', hint: '入库' },
    { key: 'omUse', mark: '领', label: '甲供材领用', hint: '出库' },
    { key: 'omDirect', mark: '直', label: '直入直出', hint: '不入库直用' },
  ] },
  { type: 'group', key: 'g-finance', label: '资金管理', icon: 'i-lucide-wallet', items: [
    { key: 'invoiceLedger', mark: '账', label: '发票台账', hint: '收票·打印·修改' },
    { key: 'invoice', mark: '票', label: '发票识别', hint: '上传·校对·排版', to: '/finance/invoice' },
    { key: 'payApply', mark: '付', label: '付款申请', hint: '8 类业务' },
    { key: 'payManage', mark: '管', label: '付款管理', hint: '待支付工作台' },
    { key: 'receipt', mark: '收', label: '收款登记', hint: '关联合同·开票' },
    { key: 'invApply', mark: '开', label: '开票申请', hint: '收入侧起点' },
    { key: 'current', mark: '往', label: '往来收付', hint: '非合同类' },
    { key: 'payRecord', mark: '流', label: '支付记录', hint: '实付流水' },
    { key: 'reimburse', mark: '销', label: '费用报销', hint: '个人报销' },
    { key: 'factor', mark: '因', label: '开票·税额工具', hint: '推算数量', to: '/finance/invoice/factor' },
  ] },
  { type: 'group', key: 'g-other', label: '项目其他合同', icon: 'i-lucide-file-stack', items: [
    { key: 'companyExp', mark: '司', label: '公司支出合同', hint: '房租·软件' },
    { key: 'otherExp', mark: '杂', label: '其他支出合同', hint: '项目杂项支出' },
    { key: 'otherSettle', mark: '结', label: '其他支出结算', hint: '结算台账' },
  ] },
  { type: 'group', key: 'g-base', label: '基础信息', icon: 'i-lucide-database', items: [
    { key: 'supplier', mark: '方', label: '分供方', hint: '资料管理', to: '/base/supplier' },
    { key: 'customer', mark: '客', label: '客户', hint: '甲方档案' },
    { key: 'crew', mark: '组', label: '班组管理', hint: '单价·配置', to: '/base/crew' },
    { key: 'worker', mark: '工', label: '工人信息', hint: '人员证书', to: '/base/worker' },
  ] },
  { type: 'group', key: 'g-settings', label: '设置', icon: 'i-lucide-settings', items: [
    { key: 'ocrSettings', mark: '设', label: 'OCR 设置', hint: '引擎·参数' },
  ] },
]

/** 默认展开的分组：对齐设计稿批A（除「设置」外全部展开） */
export const DEFAULT_OPEN_GROUPS: string[] = NAV_TREE
  .filter((n): n is NavGroup => n.type === 'group' && n.key !== 'g-settings')
  .map(n => n.key)

/**
 * 路由 path → 应点亮的导航 key。
 * 详情页点亮来源列表（/project/xx → project）；合同详情按 kind 由调用方传入。
 */
export function activeNavKey(path: string, contractKindOfDetail?: string | null): string | null {
  if (path === '/')
    return 'home'
  if (path.startsWith('/project'))
    return 'project'
  if (path.startsWith('/base/supplier'))
    return 'supplier'
  if (path.startsWith('/base/crew'))
    return 'crew'
  if (path.startsWith('/base/worker'))
    return 'worker'
  if (path.startsWith('/finance/invoice/factor'))
    return 'factor'
  if (path.startsWith('/finance/invoice'))
    return 'invoice'
  if (path.startsWith('/contract/construction'))
    return 'conContract'
  if (path.startsWith('/contract/subcontract'))
    return 'subContract'
  if (path.startsWith('/contract/material'))
    return 'matContract'
  if (/^\/contract\/[^/]+/.test(path)) {
    // 合同详情：按 kind 点亮来源列表（查不到时不点亮）
    if (contractKindOfDetail === '施工')
      return 'conContract'
    if (contractKindOfDetail === '分包')
      return 'subContract'
    if (contractKindOfDetail === '材采')
      return 'matContract'
    return null
  }
  if (path.startsWith('/subcontract/quantity'))
    return 'quantity'
  // 考勤从工资页进入，归属工资核算入口
  if (path.startsWith('/subcontract/payroll') || path.startsWith('/subcontract/attendance'))
    return 'payroll'
  if (path.startsWith('/material/delivery'))
    return 'delivery'
  if (path.startsWith('/material/price'))
    return 'price'
  return null
}
