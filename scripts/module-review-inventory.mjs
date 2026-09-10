// #403 的源码采证清单。只登记实际接线与入口，不定义业务字段或提升运行验收。
// 页签/子表的权威规格仍在 docs/rewrite/pages；参考证据仍在 runtime-reference-audit。
export const SOURCE_BASELINE = '8252e1abe1520d03aa75c48f7bf237631742ddf7'
export const OBSERVATION_DATE = '2026-09-08'

export const ADAPTERS = {
  'central-http': {
    read: 'HTTP Repository；测试服务实例',
    write: '中央 command（仅已暴露动作；逐动作原子性/幂等/版本待核验）',
    storage: '中央测试实例 Map；不具备进程重启持久化证据',
    sources: [
      ['app/plugins/repositories.ts', 'createHttpProjectListRepository'],
      ['server/utils/project-command-test-instance.ts', 'new Map'],
      ['docs/adr/0020-browser-authority-and-demo-workspace-boundary.md', '持久化'],
    ],
  },
  'browser-local': {
    read: '本地 DB adapter：sql.js / IndexedDB 快照',
    write: '本地 DB 事务；尚未接管的业务边界，不能冒充中央正式写入',
    storage: 'IndexedDB crm-new-browser / database_snapshots；文件正文须另验',
    sources: [['app/lib/db/connection.ts', 'sql.js'], ['app/lib/db/browser-storage.ts', 'database_snapshots']],
  },
  'desktop-sqlite': {
    read: 'Tauri 本地 DB adapter',
    write: '现有桌面 SQLite 分支；本轮只核对既有能力',
    storage: 'sqlite:crm.db；桌面正式交付不在本轮扩展范围',
    sources: [['app/lib/db/connection.ts', 'sqlite:crm.db']],
  },
  'credential-browser': {
    read: '中央核对分供方身份；仅 demo 可读本地证照快照',
    write: '正式浏览器证照专用存储未接入；demo 只读',
    storage: '正式证照正文未接入，不能用本地演示快照证明正式可用',
    sources: [['app/components/supplier/SupplierCredentialScreen.vue', 'isTauri']],
  },
  'simulation': {
    read: '合成导入演示',
    write: '模拟成功/首次失败，无业务记录写入',
    storage: '无业务持久化',
    sources: [['app/lib/kit/import-entities.ts', 'demoFailedOnce']],
  },
  'precheck-only': {
    read: '本地来源预检',
    write: '只预检，不写业务行',
    storage: '无导入写入',
    sources: [['app/lib/kit/import-entities.ts', 'quantity-legacy-precheck']],
  },
  'file-workflow': {
    read: '导出任务上下文与选定数据集',
    write: '生成真实文件；不是业务存储写入',
    storage: '瞬时文件工作流；完整数据集/正文/失败清理分别验收',
    sources: [['app/components/export/ExportConfigForm.vue', '<template>']],
  },
  'tool-local-storage': {
    read: 'localStorage 因子工具配置；当前计算结果在内存',
    write: 'useLocalStorage 保存 sum-solver-state；不写业务记录',
    storage: 'WebView/browser localStorage；不是 SQLite 或中央持久化',
    sources: [['app/composables/useFactorSolver.ts', 'sum-solver-state']],
  },
  'migration-browser': {
    read: '本地旧快照 + 中央预检/对账',
    write: '显式迁移确认/切换/回滚；正式执行需另获授权',
    storage: '中央测试实例；备份恢复不构成生产数据库验收',
    sources: [['app/lib/migration/core-local-source.ts', 'browser-only']],
  },
  'unsupported': {
    read: '当前宿主不支持',
    write: '禁止执行',
    storage: '不适用',
    sources: [['app/lib/migration/core-local-source.ts', 'browser-only']],
  },
}

// 一个域可混用适配器，例外在 resolveAdapter 中逐路由判断。
export const LOCAL_DOMAINS = new Set([
  'home',
  'material',
  'owner-material',
  'delivery',
  'material-price',
  'finance-income',
  'finance-expense',
  'invoice',
  'quantity-payroll',
  'schedule-target-cost',
  'ocr-settings',
])

export function resolveAdapter(surface, host) {
  const local = host === 'browser' ? 'browser-local' : 'desktop-sqlite'
  const { route, domain, mode, kind, variant } = surface
  if (route === '/settings/data-migration')
    return host === 'browser' ? 'migration-browser' : 'unsupported'
  if (route === '/export/config/:jobId')
    return 'file-workflow'
  if (route === '/finance/invoice/factor')
    return 'tool-local-storage'
  if (route === '/import/mapping/:entity') {
    if (kind === 'supplier' || kind === 'project')
      return 'central-http'
    if (kind === 'demo-supplier')
      return 'simulation'
    if (kind === 'quantity-legacy-precheck')
      return 'precheck-only'
    return local
  }
  if (route === '/base/supplier/credential/:id')
    return host === 'browser' ? 'credential-browser' : local
  if (route === '/contract/:id')
    return variant === 'central' ? 'central-http' : local
  if (route.startsWith('/contract/boq') || route.startsWith('/material/settlement'))
    return local
  if (route === '/finance/receipt/:id' || variant === 'central-source')
    return 'central-http'
  if (LOCAL_DOMAINS.has(domain))
    return local
  if (host === 'browser' || domain === 'project-supplier')
    return 'central-http'
  if (['owner-document', 'subcontract-document'].includes(domain))
    return route === '/project/penalty/:id' ? 'central-http' : local
  if (['core-contract', 'aux-contract'].includes(domain))
    return surface.template === '详情' ? 'central-http' : local
  if (mode === 'new' || mode === 'edit')
    return local
  if (route.startsWith('/base/crew') || route.startsWith('/base/worker'))
    return local
  return 'central-http'
}

// 只录入这次登录会话实际可见的菜单。pending 不等于排除，不由菜单名称推断行为。
function menu(group, label, localTargets, issues, mappingStatus = 'mapped', note = '') {
  return {
    group,
    label,
    localTargets,
    issues,
    mappingStatus,
    note,
    observation: 'menu-only',
    date: OBSERVATION_DATE,
    viewport: '1293x1051',
    evidence: 'docs/design/runtime-reference-audit.md#2026-09-08-复核基线与展开边界',
  }
}

export const REFERENCE_MENUS = [
  menu('工程项目管理', '首页', ['/'], [414], 'partial', '仅施工进度属于当前首页范围'),
  menu('工程项目管理', '项目信息', ['/project'], [408]),
  menu('工程项目管理', '目标成本', ['/project/target-cost'], [412]),
  ...['分析', '公告', '审批'].map(label => menu('统计分析', label, [], [402], 'excluded', '独立统计门户/完整审批按 #402 排除；现有通知与 capability 仍须复核')),
  menu('乙供材管理', '仓库档案', [], [411], 'pending', '尚未找到独立本地路由；仓库业务归属和已有字段需核验'),
  menu('乙供材管理', '材料采购合同', ['/contract/material'], [409]),
  menu('乙供材管理', '下料单', ['/material/requisition'], [411]),
  menu('乙供材管理', '材料到货', ['/material/arrival'], [411]),
  menu('乙供材管理', '材料领用', ['/material/use'], [411]),
  menu('乙供材管理', '乙供材直入直出', [], [411], 'pending', '不能把甲供材 direct 当作乙供对应能力'),
  menu('乙供材管理', '批量调拨', [], [411], 'pending'),
  menu('乙供材管理', '材料采购结算', ['/material/settlement'], [409]),
  menu('乙供材管理', '库存盘点', ['/material/stock-check'], [411]),
  ...[['甲供材总控量', 'control'], ['甲供材下料单', 'requisition'], ['甲供材到货', 'arrival'], ['甲供材领用', 'use'], ['甲供材直入直出', 'direct']]
    .map(([label, kind]) => menu('甲供材管理', label, [`/owner-material/${kind}`], [411])),
  ...[['分包合同', '/contract/subcontract', 409], ['项目罚扣', '/project/penalty', 410], ['分包结算', '/subcontract/settlement', 410], ['分包变洽签', '/subcontract/change', 410]]
    .map(([label, route, issue]) => menu('分包及人工', label, [route], [issue])),
  ...[['开票申请', 'billing'], ['收款登记', 'receipt'], ['收票登记', 'ledger'], ['付款申请', 'payment'], ['费用报销', 'reimbursement'], ['付款管理', 'payment-management'], ['支付记录', 'records']]
    .map(([label, route]) => menu('资金管理', label, [`/finance/${route}`], [413])),
  ...['保证金申请', '保证金退还', '备用金申请', '备用金退还'].map(label => menu('资金管理', label, [], [413], 'pending', '只有菜单证据，尚不能裁定为瑞航往来单据或现有付款类型')),
  menu('资金管理', '往来收款', ['/finance/current'], [413], 'partial', '按本地实际收付方向逐场景核验'),
  menu('资金管理', '往来付款', ['/finance/current'], [413], 'partial', '按本地实际收付方向逐场景核验'),
  menu('基础信息', '客户', ['/base/customer'], [407]),
  menu('基础信息', '分供方', ['/base/supplier'], [407]),
  menu('基础信息', '往来单位', [], [407], 'pending', 'Party/客户/分供方的当前归属须依 CONTEXT 核对，不新造平行主档'),
  menu('主合同管理', '施工合同', ['/contract/construction'], [409]),
  ...[['甲方报量', 'report'], ['甲方罚扣单', 'penalty'], ['甲方变洽签', 'change'], ['竣工验收', 'acceptance'], ['最终结算', 'final-settlement'], ['保修到期确认单', 'acceptance?variant=warranty']]
    .map(([label, route]) => menu('主合同管理', label, [`/owner/${route}`], [410])),
  menu('项目其他合同', '项目其他收入合同', [], [409], 'pending', '独立收入合同现有范围及本地对应待核对'),
  ...[['其他支出合同', 'other-expense'], ['其他支出结算', 'other-settlement'], ['公司支出合同', 'company-expense']]
    .map(([label, route]) => menu('项目其他合同', label, [`/contract/${route}`], [409])),
  ...['物品档案', '物品领用单', '物品移交单', '物品归还单', '物品销毁单'].map(label => menu('物品管理', label, [], [402], 'excluded', '独立办公物品管理不在 #402 当前范围')),
  ...['日程', '文件', '任务'].map(label => menu('协同办公', label, [], [402], 'excluded', '独立协同办公不在 #402 当前范围；瑞航业务附件/排程不因此排除')),
]

// path 是稳定场景身份，anchor 是组件中的实际挂载或 key；名称不是新的业务规格。
const view = (path, anchor, type, condition = '') => ({ path, label: path.split('/').at(-1), anchor, type, condition })
const tabs = keys => keys.map(key => view(`tab/${key}`, `'${key}'`, 'tab'))
const mounted = (type, names) => names.map(name => view(`${type}/${name}`, name, type))
const group = (selector, source, views, hosts) => ({ selector, source, views, hosts })
const contract = kind => ({ route: '/contract/:id', variant: 'central', kind })
const contractTable = path => view(`tab/${path.split('.')[0]}/table/${path.split('.').at(-1)}`, `sections.${path}`, 'subtable')

export const SUBVIEWS = [
  group({ route: '/base/customer/:id' }, 'app/components/master-data/CustomerDetailScreen.vue', tabs(['projects', 'contracts', 'receipts'])),
  group({ route: '/base/customer/:id' }, 'app/components/master-data/CustomerDetailRelations.vue', ['projects', 'contracts', 'receipts'].map(key => view(`tab/${key}/table`, 'KitTable', 'subtable'))),
  group({ route: '/base/supplier/:id' }, 'app/components/supplier/SupplierDetailScreen.vue', tabs(['overview', 'projects', 'contracts', 'settlements', 'invoices', 'payments'])),
  group({ route: '/base/supplier/:id' }, 'app/components/supplier/SupplierFactTable.vue', ['projects', 'contracts', 'settlements', 'invoices', 'payments'].map(key => view(`tab/${key}/table`, `'${key}'`, 'subtable'))),
  group({ route: '/base/crew/:id' }, 'app/components/crew-worker/CrewMemberSection.vue', [view('table/members', 'detail.members', 'subtable')], ['browser']),
  group({ route: '/base/crew/:id' }, 'app/components/crew-worker/CrewWorkerCentralDetailScreen.vue', ['projects', 'penalties'].map(key => view(`table/${key}`, `crewDetail.${key}`, 'subtable')), ['browser']),
  group({ route: '/base/worker/:id' }, 'app/components/crew-worker/CrewWorkerCentralDetailScreen.vue', ['relatedWorkers', 'assignments', 'wageStatements', 'penalties'].map(key => view(`facts/${key}`, `workerDetail.${key}`, 'facts')), ['browser']),
  group({ route: '/base/crew/:id' }, 'app/components/master-data/CrewDetailScreen.vue', mounted('section', ['CrewDetailCapabilities', 'CrewDetailMembers', 'CrewDetailProjects', 'CrewDetailPenalties']), ['tauri']),
  group({ route: '/base/worker/:id' }, 'app/components/worker/WorkerDetailScreen.vue', mounted('section', ['WorkerDetailProfile', 'WorkerDetailProjects', 'WorkerDetailLaborFacts', 'WorkerDetailAside']), ['tauri']),
  group({ route: '/project/:id' }, 'app/components/project/ProjectDetailTab.vue', ['basic', 'participants', 'system'].map(key => view(`section/${key}`, `'${key}'`, 'section'))),
  group({ route: '/project/:id' }, 'app/components/project/ProjectDetailScreen.vue', [
    ...mounted('journey', ['ProjectMaterialContractJourney', 'AuxiliaryContractJourney']),
    ...['change', 'report', 'acceptance', 'warranty', 'final-settlement', 'penalty', 'project-penalty', 'sub-settlement', 'sub-change'].map(key => view(`journey/owner/${key}`, `'${key}'`, 'journey')),
    view('relations/suppliers', 'ProjectSupplierLinksPanel', 'subtable'),
  ]),
  group({ route: '/project/:pid/supplier/:sid' }, 'app/components/project-supplier/ProjectSupplierWorkbench.vue', [...tabs(['overview', 'contract', 'claim', 'ticket', 'payment', 'settlement']), view('files', 'ProjectSupplierFilePanel', 'files')]),
  group({ route: '/project/:pid/supplier/import' }, 'app/components/project-supplier/ProjectSupplierImportWizard.vue', ['files', 'classify', 'confirm'].map(key => view(`step/${key}`, `'${key}'`, 'wizard-step'))),
  group(contract('construction'), 'app/components/contract/ConstructionContractDetailScreen.vue', [
    ...tabs(['info', 'supplements', 'changes', 'settlements', 'invoices', 'receipts', 'acceptance']),
    ...['supplements', 'changes', 'settlements.monthlyStatements', 'settlements.finalSettlements', 'settlements.penalties', 'invoices.applications', 'invoices.registrations', 'receipts', 'acceptance.acceptances', 'acceptance.warranties'].map(contractTable),
    view('tab/info/files', 'files', 'files'),
  ], ['browser']),
  group(contract('subcontract'), 'app/components/contract/SubcontractContractDetailScreen.vue', [
    ...tabs(['info', 'changes', 'invoices', 'payments', 'settlements', 'penalties', 'material-uses']),
    view('tab/changes/table/supplements', 'sections.supplements', 'subtable'),
    ...['changes', 'invoices', 'payments.applications', 'payments.records', 'settlements.progress', 'settlements.completion', 'penalties'].map(contractTable),
    view('tab/info/files', 'files', 'files'),
    view('tab/material-uses/unlinked', '暂无材料使用记录', 'unlinked-placeholder', '当前没有材料领用事实表；不能记作完整关联'),
  ], ['browser']),
  group(contract('material'), 'app/components/contract/MaterialContractDetailScreen.vue', [
    ...tabs(['info', 'lines', 'materials', 'invoices', 'payments', 'settlements', 'penalties']),
    ...['requisitions', 'arrivals', 'directTransfers', 'outbound'].map(key => view(`tab/materials/table/${key}`, key, 'subtable')),
    view('tab/lines/table', 'sections.lineItems', 'subtable'),
    ...['invoices', 'payments', 'settlements', 'penalties'].map(key => view(`tab/${key}/table`, `sections.${key}`, 'subtable')),
    view('tab/info/files', 'files', 'files'),
  ], ['browser']),
  group({ route: '/contract/:id', variant: 'legacy' }, 'app/pages/contract/[id].vue', tabs(['info', 'documents', 'files'])),
  group({ route: '/contract/:id', variant: 'legacy', kind: '材采' }, 'app/pages/contract/[id].vue', tabs(['lines'])),
  group({ route: ['/contract/company-expense/:id', '/contract/other-expense/:id'] }, 'app/components/contract/AuxiliaryContractDetailScreen.vue', tabs(['info', 'invoice', 'payment'])),
  group({ route: '/contract/other-expense/:id' }, 'app/components/contract/AuxiliaryContractDetailScreen.vue', tabs(['settlement', 'supplement'])),
  group({ route: '/contract/other-settlement/:id' }, 'app/components/other-settlement/OtherSettlementDetailScreen.vue', tabs(['info', 'penalty', 'application', 'payment'])),
  group({ route: '/contract/other-settlement/:id' }, 'app/components/other-settlement/OtherSettlementFacts.vue', [view('facts/source-detail', 'OtherSettlementSourceDetail', 'source-detail', 'query fact 选中事实；空 feed 与空数组分别验收')]),
  group({ route: '/owner/:kind/:id', kind: ['owner_change', 'owner_report'] }, 'app/components/owner-document/OwnerCommercialDocumentDetailScreen.vue', [view('table/lines', '<table', 'subtable')], ['browser']),
  group({ route: '/owner/:kind/:id', kind: 'acceptance' }, 'app/components/owner-document/OwnerAcceptanceDetailScreen.vue', [...tabs(['acceptance', 'warranty']), ...mounted('section', ['OwnerAcceptanceFactsPanel', 'OwnerAcceptanceFilesPanel', 'OwnerAcceptanceAuditPanel'])], ['browser']),
  group({ route: '/owner/:kind/:id', kind: 'final_settlement' }, 'app/components/owner-document/OwnerFinalSettlementDetailScreen.vue', mounted('section', ['OwnerFinalSettlementFactsPanel', 'OwnerFinalSettlementSourceTable', 'OwnerAcceptanceFilesPanel']), ['browser']),
  group({ route: '/owner/:kind/:id', kind: 'owner_penalty' }, 'app/components/owner-document/OwnerPenaltyDetailScreen.vue', mounted('section', ['OwnerPenaltyFactsPanel', 'OwnerAcceptanceFilesPanel']), ['browser']),
  group({ route: '/subcontract/:kind/:id', kind: 'sub_change' }, 'app/components/owner-document/SubcontractChangeDetailScreen.vue', [view('section/basic', 'subcontract-change-basic-title', 'section'), view('files', 'subcontract-change-files-title', 'files')], ['browser']),
  group({ route: '/subcontract/:kind/:id', kind: 'sub_settlement' }, 'app/components/owner-document/SubcontractSettlementDetailScreen.vue', ['basic', 'payment', 'files'].map(key => view(`section/${key}`, `subcontract-settlement-${key}-title`, key === 'files' ? 'files' : 'section')), ['browser']),
  group({ route: '/owner/:kind/:id' }, 'app/pages/owner/[kind]/[id].vue', [view('desktop/form', 'OwnerDocumentFormPage', 'legacy-form', '桌面详情路由实际进入既有整页表单；可编辑性依单据状态')], ['tauri']),
  group({ route: '/subcontract/:kind/:id' }, 'app/pages/subcontract/[kind]/[id].vue', [view('desktop/form', 'OwnerDocumentFormPage', 'legacy-form', '桌面详情路由实际进入既有整页表单；可编辑性依单据状态')], ['tauri']),
  group({ route: '/project/penalty/:id', variant: 'default' }, 'app/components/owner-document/ProjectPenaltyDetailScreen.vue', [view('history', 'ProjectPenaltyHistory', 'subtable'), view('files', 'detail.files', 'files')]),
  group({ route: '/contract/boq' }, 'app/components/boq/BoqWorkspace.vue', [...tabs(['lines', 'changes', 'monthly']), ...mounted('workspace', ['BoqCatalogTree', 'BoqLinesTable', 'BoqChangeWorkspace', 'BoqMonthlyWorkspace'])]),
  group({ route: '/contract/boq/import' }, 'app/components/boq/BoqImportWizard.vue', [
    ...['upload', 'confirm', 'preview'].map(key => view(`step/${key}`, `'${key}'`, 'wizard-step')),
    view('step/preview/table', 'includedPreviewRows', 'subtable', '只显示前 100 行；完整导入行数/来源/复核另验'),
    ...['requiresReview', 'mappingError', 'parseError'].map(key => view(`state/${key}`, key, 'state')),
  ]),
  group({ route: '/subcontract/quantity' }, 'app/components/quantity/QuantityScreen.vue', [...mounted('workspace', ['QuantityProgressCards', 'QuantityWorkspace']), ...mounted('dialog', ['QuantityAssignmentDialog', 'QuantityCompletionDialog', 'QuantityBatchCompletionDialog', 'QuantityVarianceDialog'])]),
  group({ route: '/subcontract/quantity' }, 'app/components/quantity/QuantityAssignmentDialog.vue', [...['target', 'units', 'scopes'].map(key => view(`dialog/assignment/section/${key}`, `'${key}'`, 'form-section')), ...['crew', 'worker', 'whole', 'detailed'].map(key => view(`dialog/assignment/tab/${key}`, `'${key}'`, 'tab'))]),
  group({ route: '/subcontract/quantity' }, 'app/components/quantity/QuantityCompletionDialog.vue', ['stage', 'record', 'completed', 'draft'].map(key => view(`dialog/completion/${key}`, `'${key}'`, 'form-section'))),
  group({ route: '/subcontract/quantity/:pid/:uid', variant: 'default' }, 'app/components/quantity/QuantityUnitDetailScreen.vue', [view('group/stage/quantities', 'stage.quantities', 'matrix', '按实际工种、stage.id、roomId:itemId 展开，不能用固定表数替代'), view('group/stage/photos', 'stage.photos', 'files')]),
  group({ route: '/subcontract/quantity/template' }, 'app/components/quantity/QuantityTemplateFormPage.vue', mounted('section', ['QuantityTemplateBasicSection', 'QuantityTemplateRoomsSection', 'QuantityTemplateLinesSection'])),
  group({ route: '/subcontract/quantity/region' }, 'app/components/quantity/QuantityRegionFormPage.vue', ['createBuilding', 'createFloor', 'createUnit'].map(key => view(`form/${key}`, key, 'form-section'))),
  group({ route: '/subcontract/payroll' }, 'app/components/payroll/PayrollScreen.vue', mounted('workspace', ['PayrollStatementTable', 'PayrollStatementDetail'])),
  group({ route: '/subcontract/payroll' }, 'app/components/payroll/PayrollStatementDetail.vue', [view('embedded/lines', '<table', 'subtable'), ...mounted('dialog', ['PayrollReleaseAllocationDialog']), ...mounted('print', ['PayrollPrintSheet'])]),
  group({ route: '/subcontract/payroll/:id', variant: 'default' }, 'app/components/payroll/PayrollStatementDetailScreen.vue', mounted('table', ['PayrollStatementMembersTable', 'PayrollStatementLinesTable'])),
  group({ route: '/subcontract/payroll/:id', variant: 'default' }, 'app/components/payroll/PayrollStatementDetailScreen.vue', [view('table/daywork', 'PayrollStatementDayworkTable', 'subtable', '仅 formatFamily=C2')]),
  group({ route: '/subcontract/payroll/new' }, 'app/components/payroll/PayrollDraftFormPage.vue', ['basic', 'source', 'members', 'audit'].map(key => view(`section/${key}`, `'${key}'`, 'form-section'))),
  group({ route: ['/schedule', '/schedule/:pid'] }, 'app/components/schedule/ScheduleScreen.vue', mounted('workspace', ['ScheduleBoard', 'ScheduleTaskDialog', 'ScheduleDependencyDialog'])),
  group({ route: ['/schedule', '/schedule/:pid'] }, 'app/components/schedule/ScheduleTimeline.vue', ['wbs', 'gantt'].map(key => view(`workspace/mobile/${key}`, `'${key}'`, 'matrix'))),
  group({ route: '/project/target-cost/:id' }, 'app/components/target-cost/TargetCostDetailScreen.vue', [...tabs(['items', 'comparison']), ...mounted('table', ['TargetCostItemEditor', 'TargetCostItemTable', 'TargetCostComparisonTable'])]),
  group({ route: '/material/delivery' }, 'app/components/delivery/DeliveryRecognitionScreen.vue', [...['queue', 'source', 'review'].map(key => view(`pane/${key}`, `#${key}`, 'pane')), view('duplicates', 'DeliveryDuplicateReviewPanel', 'review-panel')]),
  group({ route: '/material/delivery' }, 'app/components/delivery/DeliveryReviewPanel.vue', mounted('pane/review', ['DeliveryDocumentFields', 'DeliveryItemsEditor'])),
  group({ route: '/finance/invoice' }, 'app/components/invoice/InvoiceWorkspaceScreen.vue', [...['queue', 'source', 'review'].map(key => view(`pane/${key}`, `#${key}`, 'pane')), view('manual-entry', 'InvoiceManualEntryDialog', 'dialog')]),
  group({ route: '/finance/invoice', variant: 'review' }, 'app/components/invoice/InvoiceWorkspaceScreen.vue', mounted('pane/source', ['InvoiceOriginalPanel'])),
  group({ route: '/finance/invoice', variant: 'print' }, 'app/components/invoice/InvoiceWorkspaceScreen.vue', mounted('pane/source', ['InvoicePrintLayout'])),
  group({ route: '/finance/invoice' }, 'app/components/invoice/InvoiceReviewForm.vue', [view('pane/review/items', 'showItems', 'subtable', 'OCR 完成且展示明细；识别失败/待识别/未选票分开核验')]),
  group({ route: '/finance/payment/:id/detail' }, 'app/components/finance/PaymentApplicationDetailScreen.vue', mounted('insight', ['PaymentApplicationInsightPanel'])),
  group({ route: '/settings/data-migration' }, 'app/components/migration/CoreIdentityMigrationScreen.vue', mounted('section', ['MigrationPreflightPanel', 'MigrationReconciliationTable', 'MigrationSwitchPanel'])),
]

export const PUBLIC_SURFACES = [
  { key: 'navigation-tabs', label: '侧栏、业务页签、刷新与脏数据关闭保护', source: 'app/components/layout/AppTabBar.vue', anchor: '<template>', issues: [404] },
  { key: 'kit-ui', label: '确认、轻量表单、结果消息与处理消息', source: 'app/components/shared/KitUIHost.vue', anchor: '<template>', issues: [404] },
  { key: 'notifications', label: '通知抽屉 todo / notice 及目标返回', source: 'app/components/shared/NotificationDrawer.vue', anchor: '<template>', issues: [404] },
]
