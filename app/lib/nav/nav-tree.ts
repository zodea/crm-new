// @unocss-include
// 侧栏导航树 —— 单一权威源：保留完整业务 IA，呈现层对齐红圈紧凑单行菜单。
// icon=Lucide 线性图标、hint=搜索与 tooltip 副提示；to 缺省 = 页面尚未实装（侧栏灰显，
// 对应 #87 roadmap 后续域 / #91 批C-E，实装后回填 to 即上线入口）。

export interface NavLeaf {
  key: string
  /** 可静态提取的 UnoCSS Lucide 图标类名 */
  icon: string
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
  { type: 'item', key: 'home', icon: 'i-lucide-house', label: '首页', hint: '总览', to: '/' },
  { type: 'group', key: 'g-project', label: '项目信息', icon: 'i-lucide-building', items: [
    { key: 'project', icon: 'i-lucide-folder-kanban', label: '项目列表', hint: '工期进度', to: '/project' },
    { key: 'schedule', icon: 'i-lucide-calendar-clock', label: '施工进度', hint: '排程 · 甘特' },
    { key: 'targetCost', icon: 'i-lucide-target', label: '目标成本', hint: '预算基准' },
  ] },
  { type: 'group', key: 'g-main', label: '主合同管理', icon: 'i-lucide-file-pen', items: [
    { key: 'conContract', icon: 'i-lucide-signature', label: '施工合同', hint: '收入合同', to: '/contract/construction' },
    { key: 'ownerChange', icon: 'i-lucide-file-diff', label: '甲方变洽签', hint: '变更·签证' },
    { key: 'ownerReport', icon: 'i-lucide-chart-no-axes-column-increasing', label: '甲方报量', hint: '月度报量' },
    { key: 'acceptance', icon: 'i-lucide-badge-check', label: '竣工验收·保修', hint: '阶段流转' },
    { key: 'finalSettle', icon: 'i-lucide-circle-check-big', label: '最终结算', hint: '与甲方结算' },
    { key: 'ownerPenalty', icon: 'i-lucide-gavel', label: '甲方罚扣单', hint: '对我方罚扣' },
    { key: 'boqImport', icon: 'i-lucide-file-scan', label: '清单拆表', hint: '合同清单→表格' },
  ] },
  { type: 'group', key: 'g-sub', label: '分包及人工', icon: 'i-lucide-hard-hat', items: [
    { key: 'subContract', icon: 'i-lucide-handshake', label: '分包合同', hint: '劳务·专业', to: '/contract/subcontract' },
    { key: 'subChange', icon: 'i-lucide-file-pen-line', label: '分包变洽签', hint: '增项·签证' },
    { key: 'subSettle', icon: 'i-lucide-scale', label: '分包结算', hint: '结算台账' },
    { key: 'projPenalty', icon: 'i-lucide-circle-minus', label: '项目罚扣', hint: '罚款·抵扣' },
    { key: 'quantity', icon: 'i-lucide-grid-3x3', label: '工程量管理', hint: '矩阵可视化', to: '/subcontract/quantity' },
    { key: 'boqList', icon: 'i-lucide-list-tree', label: '工程量清单', hint: '分项·三量' },
    { key: 'payroll', icon: 'i-lucide-wallet-cards', label: '工资核算', hint: '核算发放', to: '/subcontract/payroll' },
    { key: 'wageSlip', icon: 'i-lucide-badge-dollar-sign', label: '工资进度款', hint: '铺贴核算工具' },
  ] },
  { type: 'group', key: 'g-material', label: '乙供材管理', icon: 'i-lucide-package', items: [
    { key: 'matContract', icon: 'i-lucide-shopping-cart', label: '材料采购合同', hint: '采购台账', to: '/contract/material' },
    { key: 'matRequisition', icon: 'i-lucide-clipboard-list', label: '下料单', hint: '要料计划' },
    { key: 'matArrival', icon: 'i-lucide-package-check', label: '材料到货', hint: '入库' },
    { key: 'matUse', icon: 'i-lucide-package-open', label: '材料领用', hint: '出库' },
    { key: 'matSettle', icon: 'i-lucide-calculator', label: '材料采购结算', hint: '对账结算' },
    { key: 'stockCheck', icon: 'i-lucide-clipboard-check', label: '库存盘点', hint: '盘点生效' },
    { key: 'delivery', icon: 'i-lucide-scan-line', label: '送货单识别', hint: 'OCR 处理区', to: '/material/delivery' },
    { key: 'deliveryArchive', icon: 'i-lucide-archive', label: '送货单归档库', hint: '项目→分供方', to: '/material/delivery/archive' },
    { key: 'price', icon: 'i-lucide-chart-no-axes-combined', label: '单价对比', hint: '材料价格分析', to: '/material/price' },
  ] },
  { type: 'group', key: 'g-owner-material', label: '甲供材管理', icon: 'i-lucide-boxes', items: [
    { key: 'omTotal', icon: 'i-lucide-gauge', label: '甲供材总控量', hint: '总控/到货/领用' },
    { key: 'omRequisition', icon: 'i-lucide-list-ordered', label: '甲供材下料单', hint: '要料计划' },
    { key: 'omArrival', icon: 'i-lucide-package-plus', label: '甲供材到货', hint: '入库' },
    { key: 'omUse', icon: 'i-lucide-package-minus', label: '甲供材领用', hint: '出库' },
    { key: 'omDirect', icon: 'i-lucide-arrow-left-right', label: '直入直出', hint: '不入库直用' },
  ] },
  { type: 'group', key: 'g-finance', label: '资金管理', icon: 'i-lucide-wallet', items: [
    { key: 'invoiceLedger', icon: 'i-lucide-book-open-check', label: '发票台账', hint: '收票·打印·修改', to: '/finance/ledger' },
    { key: 'invoice', icon: 'i-lucide-scan-text', label: '发票识别', hint: '上传·校对·排版', to: '/finance/invoice' },
    { key: 'payApply', icon: 'i-lucide-badge-dollar-sign', label: '付款申请', hint: '8 类业务' },
    { key: 'payManage', icon: 'i-lucide-hand-coins', label: '付款管理', hint: '待支付工作台' },
    { key: 'receipt', icon: 'i-lucide-circle-dollar-sign', label: '收款登记', hint: '关联合同·开票' },
    { key: 'invApply', icon: 'i-lucide-file-plus-2', label: '开票申请', hint: '收入侧起点' },
    { key: 'current', icon: 'i-lucide-repeat-2', label: '往来收付', hint: '非合同类' },
    { key: 'payRecord', icon: 'i-lucide-list-checks', label: '支付记录', hint: '实付流水' },
    { key: 'reimburse', icon: 'i-lucide-receipt', label: '费用报销', hint: '个人报销' },
    { key: 'factor', icon: 'i-lucide-sigma', label: '开票·税额工具', hint: '推算数量', to: '/finance/invoice/factor' },
  ] },
  { type: 'group', key: 'g-other', label: '项目其他合同', icon: 'i-lucide-file-stack', items: [
    { key: 'companyExp', icon: 'i-lucide-building-2', label: '公司支出合同', hint: '房租·软件' },
    { key: 'otherExp', icon: 'i-lucide-files', label: '其他支出合同', hint: '项目杂项支出' },
    { key: 'otherSettle', icon: 'i-lucide-scale', label: '其他支出结算', hint: '结算台账' },
  ] },
  { type: 'group', key: 'g-base', label: '基础信息', icon: 'i-lucide-database', items: [
    { key: 'supplier', icon: 'i-lucide-factory', label: '分供方', hint: '资料管理', to: '/base/supplier' },
    { key: 'customer', icon: 'i-lucide-landmark', label: '客户', hint: '甲方档案' },
    { key: 'crew', icon: 'i-lucide-users-round', label: '班组管理', hint: '单价·配置', to: '/base/crew' },
    { key: 'worker', icon: 'i-lucide-user-round', label: '工人信息', hint: '人员证书', to: '/base/worker' },
  ] },
  { type: 'group', key: 'g-settings', label: '设置', icon: 'i-lucide-settings', items: [
    { key: 'ocrSettings', icon: 'i-lucide-scan-search', label: 'OCR 设置', hint: '引擎·参数' },
  ] },
]

/** 搜索完整导航树；分组名命中时保留组内全部叶子。 */
export function filterNavTree(tree: NavNode[], query: string): NavNode[] {
  const keyword = query.trim().toLocaleLowerCase('zh-CN')
  if (!keyword)
    return tree

  const matches = (value: string) => value.toLocaleLowerCase('zh-CN').includes(keyword)

  return tree.flatMap((node): NavNode[] => {
    if (node.type === 'item')
      return matches(node.label) || matches(node.hint) ? [node] : []

    if (matches(node.label))
      return [node]

    const items = node.items.filter(item => matches(item.label) || matches(item.hint))
    return items.length ? [{ ...node, items }] : []
  })
}

/** 默认展开的分组：对齐设计稿批A（除「设置」外全部展开） */
export const DEFAULT_OPEN_GROUPS: string[] = NAV_TREE
  .filter((n): n is NavGroup => n.type === 'group' && n.key !== 'g-settings')
  .map(n => n.key)

/** 合并持久化展开状态与当前路由归属，当前分组始终优先展开。 */
export function ensureActiveGroupOpen(openKeys: string[], activeKey: string | null): string[] {
  if (!activeKey)
    return openKeys
  const group = NAV_TREE.find((node): node is NavGroup =>
    node.type === 'group' && node.items.some(item => item.key === activeKey),
  )
  if (!group || openKeys.includes(group.key))
    return openKeys
  return [...openKeys, group.key]
}

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
  // 发票编辑页签从台账进入，点亮台账（对齐设计稿 invoiceLedger/invoiceEdit 同亮）
  if (/^\/finance\/invoice\/[^/]+/.test(path))
    return 'invoiceLedger'
  if (path.startsWith('/finance/invoice'))
    return 'invoice'
  if (path.startsWith('/finance/ledger'))
    return 'invoiceLedger'
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
  if (path.startsWith('/material/delivery/archive'))
    return 'deliveryArchive'
  if (path.startsWith('/material/delivery'))
    return 'delivery'
  if (path.startsWith('/material/price'))
    return 'price'
  return null
}
