// 运行证据账本的共享解析层：生成脚本与契约测试共用同一实现。
// 权威输入仍是页面文件、运行态参考矩阵、READ-MODELS 领域表和设计覆盖生成物；
// 本模块只把它们合成可机读、可双向核对的派生账本。

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COVERAGE_PATH,
  PROJECT_ROOT,
  readAppPageFiles,
  readAppRoutes,
} from './design-coverage.mjs'

export const RUNTIME_AUDIT_PATH = join(PROJECT_ROOT, 'docs/design/runtime-reference-audit.md')
export const READ_MODELS_PATH = join(PROJECT_ROOT, 'docs/rewrite/READ-MODELS.md')
export const RUNTIME_EVIDENCE_LEDGER_PATH = join(PROJECT_ROOT, 'docs/design/runtime-evidence-ledger.json')
export const IMPLEMENTATION_STATUS_PATH = join(PROJECT_ROOT, 'docs/design/ui-implementation-status.md')
export const RUNTIME_SUMMARY_BLOCK_BEGIN = '<!-- runtime-evidence-summary:begin -->'
export const RUNTIME_SUMMARY_BLOCK_END = '<!-- runtime-evidence-summary:end -->'
export const IMPLEMENTATION_FRONTIER_BLOCK_BEGIN = '<!-- implementation-frontier:begin -->'
export const IMPLEMENTATION_FRONTIER_BLOCK_END = '<!-- implementation-frontier:end -->'

// READ-MODELS 的稳定 code 是页面域身份；中文域名只用于展示。
const IMPLEMENTATION_ISSUES_BY_DOMAIN_CODE = new Map([
  ['home', [278]],
  ['project', [288, 293, 294, 289]],
  ['master-data', [281, 316, 289]],
  ['supplier', [281, 289]],
  ['project-supplier', [281, 289, 317]],
  ['core-contract', [277, 282, 289]],
  ['aux-contract', [295, 298, 289]],
  ['owner-document', [283, 323, 324, 325, 326, 289]],
  ['subcontract-document', [295, 289]],
  ['material', [296, 297, 298, 289]],
  ['owner-material', [299, 289]],
  ['delivery', [296, 289]],
  ['material-price', [296, 298, 289]],
  ['finance-income', [302, 289]],
  ['finance-expense', [303, 305, 289]],
  ['invoice', [304, 289]],
  ['quantity-payroll', [300, 301, 289]],
  ['schedule-target-cost', [300, 289]],
  ['import-export', [278, 294]],
  ['ocr-settings', [204]],
])

const HISTORICAL_PROFILES = new Set([
  'R-LIST-PRIOR',
  'R-FORM-PRIOR',
  'R-DETAIL-PRIOR',
  'R-WORKBENCH-PRIOR',
])
const UNVERIFIED_PROFILES = new Set(['R-TOOL-PENDING'])
const LOCAL_AUTHORITY_PROFILES = new Set([
  'R-OCR-STUDIO-SOURCE',
  'R-TARGET-COST-LOCAL',
  'R-AUX-CONTRACT-DC',
  'R-AUX-SETTLEMENT-DC',
  'R-OWNER-DOC-DC',
  'R-SUB-DOC-DC',
  'R-SCHEDULE-LOCAL',
])
const DIRECT_PROFILES = new Set([
  'R-SHELL-LIVE',
  'R-PUBLIC-SURFACES-LIVE',
  'R-HOME-LIVE',
  'R-SUBCONTRACT-LIST-LIVE',
  'R-CONSTRUCTION-CONTRACT-LIVE',
  'R-SUBCONTRACT-CONTRACT-LIVE',
  'R-CONTRACT-DETAIL-LIVE',
  'R-TABLE-LIVE',
  'R-MATERIAL-CONTRACT-LIVE',
  'R-FORM-LIVE',
  'R-DETAIL-LIVE',
  'R-PROJECT-LIST-LIVE',
  'R-PROJECT-DETAIL-LIVE',
  'R-CUSTOMER-LIST-LIVE',
  'R-SUPPLIER-LIST-LIVE',
  'R-SUPPLIER-DETAIL-LIVE',
  'R-TARGET-COST-LIVE',
  'R-OWNER-DOCUMENTS-LIVE',
  'R-SUB-DOCUMENTS-LIVE',
  'R-AUX-DOCUMENTS-LIVE',
  'R-MATERIAL-SETTLEMENT-LIVE',
  'R-MATERIAL-FLOW-LIVE',
  'R-OWNER-MATERIAL-LIVE',
  'R-FINANCE-FLOW-LIVE',
  'R-ENGINEERING-FLOW-LOCAL',
])

const RESTRICTED_TARGET_ROUTES = new Set(['/base/customer', '/project'])

// 路由级参考视图是端点身份与证据等级覆盖的单一维护点；
// 被多个本地路由复用的外部运行证据必须拆到具体目标视图。
const REFERENCE_VIEW_BY_ROUTE = new Map([
  ['/settings/data-migration', { id: 'core-data-migration-unobserved', label: '本地核心身份数据迁移；外部目标页未观察' }],
  ['/base/supplier/:id', { id: 'supplier-detail-facts', label: '基础信息 > 分供方详情 > 详细资料与四类事实页签' }],
  ['/base/supplier/credential/:id', { id: 'supplier-detail-credential-files', label: '基础信息 > 分供方详情 > 文件管理与证照资料区' }],
  ['/base/supplier/form/:id?', { id: 'supplier-form', label: '基础信息 > 分供方 > 新建分供方（编辑态未单独观察）', gradeOverride: 'adjacent' }],
  ['/contract/material/form', { id: 'material-contract-new', label: '乙供材管理 > 材料采购合同 > 新建支出合同·材料采购合同' }],
  ['/contract/material/form/:id', { id: 'material-contract-edit', label: '乙供材管理 > 材料采购合同 > 编辑（仅有相邻新建表单证据）', gradeOverride: 'adjacent' }],
  ['/project/:pid/supplier/import', { id: 'project-supplier-import-unobserved', label: '项目×分供方文件导入目标未观察；仅借用相邻空白整页表单结构', gradeOverride: 'adjacent' }],

  ['/finance/billing', { id: 'finance-billing-list', label: '资金管理 > 开票申请' }],
  ['/finance/current', { id: 'finance-current-lists', label: '资金管理 > 往来收款 / 往来付款' }],
  ['/finance/invoice', { id: 'finance-invoice-adjacent', label: '资金管理 > 收票登记（发票 OCR 工作台仅有相邻证据）', gradeOverride: 'adjacent' }],
  ['/finance/ledger', { id: 'finance-invoice-ledger', label: '资金管理 > 收票登记；项目详情 > 票税管理' }],
  ['/finance/payment/:id/detail', { id: 'finance-payment-detail-unobserved', label: '付款申请详情目标无可见记录；合同/分供方/项目资金页签为相邻证据', gradeOverride: 'adjacent' }],
  ['/finance/payment', { id: 'finance-payment-list', label: '资金管理 > 付款申请' }],
  ['/finance/payment-management', { id: 'finance-payment-management', label: '资金管理 > 付款管理' }],
  ['/finance/receipt', { id: 'finance-receipt-list', label: '资金管理 > 收款登记' }],
  ['/finance/receipt/:id', { id: 'finance-receipt-detail', label: '资金管理 > 收款登记 > 收款编号 > 只读详情' }],
  ['/finance/records', { id: 'finance-payment-records', label: '资金管理 > 支付记录' }],
  ['/finance/reimbursement', { id: 'finance-reimbursement-list', label: '资金管理 > 费用报销' }],

  ['/material/arrival', { id: 'material-arrival-list', label: '乙供材管理 > 材料到货' }],
  ['/material/requisition', { id: 'material-requisition-list', label: '乙供材管理 > 下料单' }],
  ['/material/stock-check', { id: 'material-stock-check-list', label: '乙供材管理 > 库存盘点' }],
  ['/material/use', { id: 'material-use-list', label: '乙供材管理 > 材料领用' }],
  ['/material/settlement', { id: 'material-settlement-list', label: '乙供材管理 > 材料采购结算' }],
  ['/material/settlement/form/:id', { id: 'material-settlement-detail', label: '乙供材管理 > 材料采购结算 > 结算名称 > 详情-支出结算', gradeOverride: 'adjacent' }],

  ['/owner/:kind', { id: 'owner-document-list-by-kind', label: '主合同管理 > 六类甲方单据列表（按 kind）' }],
  ['/owner/:kind/:id', { id: 'owner-document-detail-by-kind', label: '甲方报量编号 > 详情-收入结算；其余 kind 详情未观察', gradeOverride: 'adjacent' }],
  ['/owner/:kind/form/:id', { id: 'owner-document-edit-by-kind', label: '甲方变洽签/报量专属整页编辑表单' }],
  ['/subcontract/:kind', { id: 'subcontract-document-list-by-kind', label: '分包及人工 > 分包变洽签 / 分包结算（按 kind）' }],
  ['/project/penalty', { id: 'project-penalty-list', label: '分包及人工 > 项目罚扣' }],

  ['/project/:id', { id: 'project-detail', label: '项目信息 > 车陂商业大楼项目' }],
  ['/project/:pid/supplier/:sid', { id: 'project-supplier-detail-unobserved', label: '项目×分供方目标页未观察；项目详情仅作相邻布局证据', gradeOverride: 'adjacent' }],
  ['/project/target-cost', { id: 'target-cost-list', label: '目标成本 > 目标成本列表' }],
  ['/project/target-cost/:id', { id: 'target-cost-detail', label: '目标成本 > 目标成本名称 > 详情-目标成本' }],

  ['/contract/company-expense', { id: 'company-expense-list', label: '项目其他合同 > 公司支出合同' }],
  ['/contract/other-expense', { id: 'other-expense-list', label: '项目其他合同 > 其他支出合同' }],
  ['/contract/other-settlement', { id: 'other-settlement-list', label: '项目其他合同 > 其他支出结算' }],

  ['/owner-material/control', { id: 'owner-material-control-list', label: '甲供材管理 > 甲供材总控量' }],
  ['/owner-material/control/:id', { id: 'owner-material-control-detail-unobserved', label: '甲供材总控量详情未观察', gradeOverride: 'adjacent' }],
  ['/owner-material/control/new', { id: 'owner-material-control-new-unobserved', label: '甲供材总控量新建入口未触发', gradeOverride: 'adjacent' }],
  ['/owner-material/requisition', { id: 'owner-material-requisition-list', label: '甲供材管理 > 甲供材下料单' }],
  ['/owner-material/requisition/:id', { id: 'owner-material-requisition-detail-unobserved', label: '甲供材下料单详情未观察', gradeOverride: 'adjacent' }],
  ['/owner-material/requisition/new', { id: 'owner-material-requisition-new-unobserved', label: '甲供材下料单新建入口未触发', gradeOverride: 'adjacent' }],
  ['/owner-material/arrival', { id: 'owner-material-arrival-list', label: '甲供材管理 > 甲供材到货' }],
  ['/owner-material/arrival/:id', { id: 'owner-material-arrival-detail-unobserved', label: '甲供材到货详情未观察', gradeOverride: 'adjacent' }],
  ['/owner-material/arrival/new', { id: 'owner-material-arrival-new-unobserved', label: '甲供材到货新建入口未触发', gradeOverride: 'adjacent' }],
  ['/owner-material/use', { id: 'owner-material-use-list', label: '甲供材管理 > 甲供材领用' }],
  ['/owner-material/use/:id', { id: 'owner-material-use-detail-unobserved', label: '甲供材领用详情未观察', gradeOverride: 'adjacent' }],
  ['/owner-material/use/new', { id: 'owner-material-use-new-unobserved', label: '甲供材领用新建入口未触发', gradeOverride: 'adjacent' }],
  ['/owner-material/direct', { id: 'owner-material-direct-list', label: '甲供材管理 > 甲供材直入直出' }],
  ['/owner-material/direct/:id', { id: 'owner-material-direct-detail-unobserved', label: '甲供材直入直出详情未观察', gradeOverride: 'adjacent' }],
  ['/owner-material/direct/new', { id: 'owner-material-direct-new-unobserved', label: '甲供材直入直出新建入口未触发', gradeOverride: 'adjacent' }],
])

function markdownCells(line) {
  return line
    .split('|')
    .slice(1, -1)
    .map(cell => cell.trim())
}

function withoutCodeTicks(value) {
  return value.replaceAll('`', '')
}

function auditRows(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter(line => line.startsWith('| `app/pages/'))
    .map((line) => {
      const [page, route, domain, template, historicalFoundationTicket, referenceProfile, layoutConclusion, stateAndNavigationConclusion, constraints] = markdownCells(line)
      return {
        page: withoutCodeTicks(page),
        route: withoutCodeTicks(route),
        domain,
        template,
        historicalFoundationTicket,
        referenceProfile,
        layoutConclusion,
        stateAndNavigationConclusion,
        constraints,
      }
    })
}

function evidenceProfiles(markdown) {
  return new Map(markdown
    .split(/\r?\n/)
    .filter(line => line.startsWith('| `R-'))
    .map((line) => {
      const [code, level, endpoint, viewport, safety] = markdownCells(line)
      const normalizedCode = withoutCodeTicks(code)
      return [normalizedCode, {
        code: normalizedCode,
        level,
        endpoint: withoutCodeTicks(endpoint),
        viewport: withoutCodeTicks(viewport),
        safety: withoutCodeTicks(safety),
      }]
    }))
}

function readModelDomains(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter(line => /^\| `[a-z][a-z-]+` \|/.test(line))
    .map((line) => {
      const cells = markdownCells(line)
      return { code: withoutCodeTicks(cells[0]), domain: cells[1], routeCount: Number(cells[2]) }
    })
}

function evidenceGrade(row, profile) {
  if (HISTORICAL_PROFILES.has(profile.code))
    return 'historical'
  if (UNVERIFIED_PROFILES.has(profile.code))
    return 'unverified-target'
  if (LOCAL_AUTHORITY_PROFILES.has(profile.code))
    return 'local-authority'
  if (!DIRECT_PROFILES.has(profile.code))
    throw new Error(`runtime-evidence-ledger: 证据档案 ${profile.code} 缺少显式等级映射`)
  return REFERENCE_VIEW_BY_ROUTE.get(row.route)?.gradeOverride ?? 'direct'
}

function permissionStatus(row, profile, grade) {
  if (grade === 'historical' || grade === 'unverified-target')
    return 'unverified'
  if (LOCAL_AUTHORITY_PROFILES.has(profile.code) || profile.code === 'R-ENGINEERING-FLOW-LOCAL')
    return 'not-applicable'
  if (RESTRICTED_TARGET_ROUTES.has(row.route))
    return 'read-only-observed-with-restricted-target'
  return 'read-only-observed'
}

function observation(profile, grade) {
  const date = /\b\d{4}-\d{2}-\d{2}\b/.exec(`${profile.viewport} ${profile.safety}`)?.[0] ?? null
  if (date)
    return { date, status: 'recorded' }
  if (grade === 'historical')
    return { date: null, status: 'not-recorded-historical' }
  if (grade === 'unverified-target')
    return { date: null, status: 'not-observed' }
  if (grade === 'local-authority')
    return { date: null, status: 'not-applicable-local-authority' }
  throw new Error(`runtime-evidence-ledger: 当前运行证据 ${profile.code} 缺少观测日期`)
}

function stableToken(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12).toUpperCase()
}

function referenceEndpoint(row, profile, grade, profileUsageCount) {
  const explicit = REFERENCE_VIEW_BY_ROUTE.get(row.route)
  if (explicit)
    return explicit
  if (grade === 'historical') {
    return {
      id: `historical-${stableToken(row.route)}`,
      label: `历史${row.template}目标未登记：${row.route}`,
    }
  }
  if (grade === 'unverified-target') {
    return {
      id: `unverified-${stableToken(row.route)}`,
      label: `目标端点未验证：${row.route}`,
    }
  }
  if (grade === 'local-authority' || profile.code === 'R-ENGINEERING-FLOW-LOCAL') {
    return {
      id: `local-${stableToken(row.route)}`,
      label: `本地权威端点：${row.route}`,
    }
  }
  if (profileUsageCount === 1) {
    return {
      id: profile.code.toLowerCase().replaceAll('_', '-'),
      label: profile.endpoint,
    }
  }
  throw new Error(`runtime-evidence-ledger: ${row.route} 复用了聚合证据 ${profile.code}，但没有拆分具体参考端点`)
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length)
    throw new Error(`runtime-evidence-ledger: ${label} 存在重复项`)
}

export function buildRuntimeEvidenceLedger() {
  const auditMarkdown = readFileSync(RUNTIME_AUDIT_PATH, 'utf8')
  const rows = auditRows(auditMarkdown)
  const profiles = evidenceProfiles(auditMarkdown)
  const contracts = readModelDomains(readFileSync(READ_MODELS_PATH, 'utf8'))
  const coverage = JSON.parse(readFileSync(COVERAGE_PATH, 'utf8'))
  const trackedPageFiles = readAppPageFiles()
  const productionRoutes = readAppRoutes()
  const devPageFiles = trackedPageFiles.filter(path => path.startsWith('dev/'))
  const auditedAt = /> 核对日期：(\d{4}-\d{2}-\d{2})/.exec(auditMarkdown)?.[1]

  if (!auditedAt)
    throw new Error('runtime-evidence-ledger: 运行证据矩阵缺少核对日期')

  assertUnique(rows.map(row => row.page), '页面')
  assertUnique(rows.map(row => row.route), '路由')
  assertUnique(contracts.map(row => row.domain), '页面域')

  const auditedPages = rows.map(row => row.page.replace(/^app\/pages\//, '')).sort()
  const productionPageFiles = trackedPageFiles.filter(path => !path.startsWith('dev/')).sort()
  if (JSON.stringify(auditedPages) !== JSON.stringify(productionPageFiles))
    throw new Error('runtime-evidence-ledger: 页面文件与运行矩阵不是同一集合')
  if (JSON.stringify(rows.map(row => row.route).sort()) !== JSON.stringify(productionRoutes))
    throw new Error('runtime-evidence-ledger: 生产路由与运行矩阵不是同一集合')

  const auditDomainCounts = new Map()
  for (const row of rows)
    auditDomainCounts.set(row.domain, (auditDomainCounts.get(row.domain) ?? 0) + 1)

  const contractDomainCounts = new Map(contracts.map(row => [row.domain, row.routeCount]))
  if (JSON.stringify([...auditDomainCounts].sort()) !== JSON.stringify([...contractDomainCounts].sort()))
    throw new Error('runtime-evidence-ledger: READ-MODELS 与运行矩阵的页面域集合或路由数不一致')

  const classifiedProfiles = new Set([
    ...HISTORICAL_PROFILES,
    ...UNVERIFIED_PROFILES,
    ...LOCAL_AUTHORITY_PROFILES,
    ...DIRECT_PROFILES,
  ])
  for (const code of profiles.keys()) {
    if (!classifiedProfiles.has(code))
      throw new Error(`runtime-evidence-ledger: 证据档案 ${code} 缺少显式等级映射`)
  }

  const contractByDomain = new Map(contracts.map(contract => [contract.domain, contract]))
  for (const contract of contracts) {
    if (!IMPLEMENTATION_ISSUES_BY_DOMAIN_CODE.has(contract.code))
      throw new Error(`runtime-evidence-ledger: 页面域 ${contract.code} 缺少当前实施票`)
  }

  const profileUsageCounts = new Map()
  for (const row of rows)
    profileUsageCounts.set(row.referenceProfile, (profileUsageCounts.get(row.referenceProfile) ?? 0) + 1)

  const endpoints = rows.map((row) => {
    const profile = profiles.get(row.referenceProfile)
    if (!profile)
      throw new Error(`runtime-evidence-ledger: ${row.route} 引用了不存在的证据档案 ${row.referenceProfile}`)
    const contract = contractByDomain.get(row.domain)
    if (!contract)
      throw new Error(`runtime-evidence-ledger: ${row.route} 的页面域“${row.domain}”未进入 READ-MODELS`)
    if (!row.layoutConclusion || !row.stateAndNavigationConclusion)
      throw new Error(`runtime-evidence-ledger: ${row.route} 缺少布局或状态与跳转结论`)
    if (!/^#\d+$/.test(row.historicalFoundationTicket))
      throw new Error(`runtime-evidence-ledger: ${row.route} 的历史基础票格式无效`)
    if (!profile.endpoint)
      throw new Error(`runtime-evidence-ledger: ${profile.code} 缺少参考端点说明`)
    const grade = evidenceGrade(row, profile)
    const observed = observation(profile, grade)
    const reference = referenceEndpoint(row, profile, grade, profileUsageCounts.get(profile.code))
    return {
      evidenceRecordId: `E-${stableToken(row.route)}`,
      page: row.page,
      localRoute: row.route,
      domainCode: contract.code,
      template: row.template,
      implementationIssues: IMPLEMENTATION_ISSUES_BY_DOMAIN_CODE.get(contract.code),
      referenceProfile: row.referenceProfile,
      referenceEndpointId: reference.id,
      referenceEndpointLabel: reference.label,
      evidenceGrade: grade,
      observationDate: observed.date,
      observationDateStatus: observed.status,
      permissionStatus: permissionStatus(row, profile, grade),
      layoutConclusion: {
        sourceDocument: 'docs/design/runtime-reference-audit.md',
        routeKey: row.route,
      },
      stateAndNavigationConclusion: {
        sourceDocument: 'docs/design/runtime-reference-audit.md',
        routeKey: row.route,
      },
      constraints: row.constraints,
    }
  })

  assertUnique(endpoints.map(endpoint => endpoint.evidenceRecordId), '证据编号')
  assertUnique(endpoints.map(endpoint => endpoint.referenceEndpointId), '参考端点')
  for (const route of REFERENCE_VIEW_BY_ROUTE.keys()) {
    if (!endpoints.some(endpoint => endpoint.localRoute === route))
      throw new Error(`runtime-evidence-ledger: 路由级参考视图 ${route} 已失效`)
  }

  const countGrade = grade => endpoints.filter(endpoint => endpoint.evidenceGrade === grade).length
  const domains = contracts.map(contract => ({
    code: contract.code,
    domain: contract.domain,
    routeCount: contract.routeCount,
    implementationIssues: IMPLEMENTATION_ISSUES_BY_DOMAIN_CODE.get(contract.code),
  }))

  if (coverage.counts.appPageFiles !== productionRoutes.length)
    throw new Error('runtime-evidence-ledger: 设计覆盖与运行矩阵的生产路由数不一致')

  return {
    $schema: '本文件由 node scripts/sync-runtime-evidence-ledger.mjs 生成；不得手改。',
    auditedAt,
    counts: {
      trackedPageFiles: trackedPageFiles.length,
      devPageFiles: devPageFiles.length,
      productionRoutes: productionRoutes.length,
      pageDomains: domains.length,
      evidenceEndpointRecords: endpoints.length,
      referenceEndpoints: new Set(endpoints.map(endpoint => endpoint.referenceEndpointId)).size,
      referenceProfiles: profiles.size,
      usedReferenceProfiles: new Set(endpoints.map(endpoint => endpoint.referenceProfile)).size,
      directEvidenceRoutes: countGrade('direct'),
      adjacentEvidenceRoutes: countGrade('adjacent'),
      localAuthorityRoutes: countGrade('local-authority'),
      historicalEvidenceRoutes: countGrade('historical'),
      unverifiedTargetRoutes: countGrade('unverified-target'),
      designCoveredRoutes: coverage.counts.covered,
      designPendingRoutes: coverage.counts.designPending,
    },
    domains,
    endpoints,
  }
}

function issueLinks(issues) {
  return issues
    .map(issue => `[#${issue}](https://github.com/zodea/crm-new/issues/${issue})`)
    .join('、')
}

function renderDomainIssueTable(domains) {
  return [
    '| 页面域 | 路由数 | 当前实施票 |',
    '| --- | ---: | --- |',
    ...domains.map(domain => `| ${domain.domain} | ${domain.routeCount} | ${issueLinks(domain.implementationIssues)} |`),
  ].join('\n')
}

export function renderRuntimeEvidenceSummary(ledger) {
  const { counts } = ledger
  return [
    '| 可重算口径 | 数量 |',
    '| --- | ---: |',
    `| 跟踪页面文件 / dev / 生产路由 | ${counts.trackedPageFiles} / ${counts.devPageFiles} / ${counts.productionRoutes} |`,
    `| 页面域 | ${counts.pageDomains} |`,
    `| 证据行 / 唯一参考端点 | ${counts.evidenceEndpointRecords} / ${counts.referenceEndpoints} |`,
    `| 参考证据档案 / 被路由使用 | ${counts.referenceProfiles} / ${counts.usedReferenceProfiles} |`,
    `| 直接 / 邻近 / 本地权威 | ${counts.directEvidenceRoutes} / ${counts.adjacentEvidenceRoutes} / ${counts.localAuthorityRoutes} |`,
    `| 历史证据 / 未验证目标 | ${counts.historicalEvidenceRoutes} / ${counts.unverifiedTargetRoutes} |`,
    `| 设计已覆盖 / 待补设计 | ${counts.designCoveredRoutes} / ${counts.designPendingRoutes} |`,
    '',
    renderDomainIssueTable(ledger.domains),
  ].join('\n')
}

function replaceMarkedBlock(source, begin, end, body, label) {
  const from = source.indexOf(begin)
  const to = source.indexOf(end)
  if (from < 0 || to < 0 || to < from)
    throw new Error(`runtime-evidence-ledger: ${label}缺少生成块标记`)
  const head = source.slice(0, from + begin.length)
  const tail = source.slice(to)
  return `${head}\n${body}\n${tail}`
}

export function replaceRuntimeEvidenceSummary(source, ledger) {
  return replaceMarkedBlock(
    source,
    RUNTIME_SUMMARY_BLOCK_BEGIN,
    RUNTIME_SUMMARY_BLOCK_END,
    renderRuntimeEvidenceSummary(ledger),
    '运行证据矩阵',
  )
}

export function renderImplementationFrontier(ledger) {
  return renderDomainIssueTable(ledger.domains)
}

export function replaceImplementationFrontier(source, ledger) {
  return replaceMarkedBlock(
    source,
    IMPLEMENTATION_FRONTIER_BLOCK_BEGIN,
    IMPLEMENTATION_FRONTIER_BLOCK_END,
    renderImplementationFrontier(ledger),
    '界面实现状态',
  )
}
