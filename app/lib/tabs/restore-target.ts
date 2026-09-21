import type { RestorableTabPath, TabRestoreValidator } from './restoration-contract'
import type { PayrollSourceKind } from '~/lib/payroll/a-navigation'
import type { DomainRepositories } from '~/plugins/repositories'
import type { DataOriginDTO } from '~/types/read-model'
import { PAYROLL_A_CONFIG_PATH, PAYROLL_SOURCE_KEYS, payrollSourceContext } from '~/lib/payroll/a-navigation'
import { PAYROLL_C1_SOURCE_KEYS, payrollC1SourceContext } from '~/lib/payroll/c1-navigation'
import { PAYROLL_C2_SOURCE_KEYS, payrollC2SourceContext } from '~/lib/payroll/c2-navigation'
import { PAYROLL_READ_QUERY_KEYS, payrollViewScope } from '~/lib/payroll/central-navigation'
import { isQuantitySourceIdentity } from '~/lib/quantity/migration-identity'
import { QUANTITY_FILTER_KEYS } from '~/lib/quantity/navigation'
import { SCHEDULE_DRILL_QUERY_KEYS } from '~/lib/schedule/navigation'
import { TARGET_COST_FILTER_KEYS, TARGET_COST_LIST_PATH, TARGET_COST_SOURCE_PATHS, TARGET_COST_SOURCE_QUERY_KEYS, targetCostSourceContext } from '~/lib/target-cost/navigation'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'
import { TAB_TARGET_VERSION } from './restoration-contract'
import { readRestoredDetail } from './restore-detail'
import { checkRestoreAbort, restoreProblem } from './restore-problem'

// 明确登记可恢复的阅读入口；导航树有链接不代表页面没有写态。
const LISTS: Record<string, [string, string?]> = {
  '/': ['首页'],
  '/project': ['项目列表', 'project:list:read'],
  '/schedule': ['施工进度', 'project:list:read'],
  '/schedule/process-library': ['工序库', 'process-library:read'],
  '/project/target-cost': ['目标成本', 'target-cost:read'],
  '/contract/construction': ['施工合同', 'construction-contract:read'],
  '/contract/subcontract': ['分包合同', 'subcontract-contract:read'],
  '/contract/material': ['材料采购合同', 'material-contract:read'],
  '/contract/boq': ['工程量清单'],
  '/contract/other-expense': ['其他支出合同', 'auxiliary-contract:read'],
  '/contract/company-expense': ['公司支出合同', 'auxiliary-contract:read'],
  '/contract/other-settlement': ['其他支出结算', 'other-settlement:read'],
  '/owner/change': ['甲方变洽签', 'owner-document:read'],
  '/owner/report': ['甲方报量', 'owner-document:read'],
  '/owner/acceptance': ['竣工验收与保修', 'owner-document:read'],
  '/owner/final-settlement': ['最终结算', 'owner-document:read'],
  '/owner/penalty': ['甲方罚扣', 'owner-document:read'],
  '/subcontract/change': ['分包变洽签', 'subcontract-document:read'],
  '/subcontract/settlement': ['分包结算', 'subcontract-document:read'],
  '/project/penalty': ['项目罚扣', 'subcontract-document:read'],
  '/subcontract/quantity': ['工程量管理'],
  '/subcontract/payroll': ['工资台账', 'payroll:read'],
  '/subcontract/payroll/sources': ['工资来源', 'payroll:read'],
  '/subcontract/payroll/payments': ['工资实际收付', 'payroll:read'],
  '/subcontract/attendance': ['考勤管理', 'payroll:read'],
  '/subcontract/daywork': ['签工管理', 'payroll:read'],
  '/material/requisition': ['下料单'],
  '/material/arrival': ['材料到货'],
  '/material/use': ['材料领用'],
  '/material/settlement': ['材料采购结算'],
  '/material/stock-check': ['库存盘点'],
  '/material/delivery/archive': ['送货单归档库', 'delivery:read'],
  '/material/price': ['单价对比'],
  '/owner-material/control': ['甲供材总控量'],
  '/owner-material/requisition': ['甲供材下料单'],
  '/owner-material/arrival': ['甲供材到货'],
  '/owner-material/use': ['甲供材领用'],
  '/owner-material/direct': ['甲供材直入直出'],
  '/finance/ledger': ['发票台账'],
  '/finance/invoice/factor': ['开票因子与税额计算'],
  '/finance/payment': ['付款申请'],
  '/finance/payment-management': ['付款管理'],
  '/finance/receipt': ['收款登记', 'receipt:read'],
  '/finance/billing': ['开票申请'],
  '/finance/current': ['往来收付'],
  '/finance/records': ['支付记录'],
  '/finance/reimbursement': ['费用报销'],
  '/base/customer': ['客户', 'customer:list:read'],
  '/base/supplier': ['分供方', 'supplier:list:read'],
  '/base/crew': ['班组', 'crew:list:read'],
  '/base/worker': ['工人', 'worker:list:read'],
}

export interface RestoredDetailPath {
  family: string
  id: string
  secondId?: string
  unitId?: string
  kind?: string
}

const DETAIL_PATTERNS: Array<[RegExp, (matches: RegExpExecArray) => RestoredDetailPath]> = [
  [/^\/subcontract\/quantity\/([^/]+)\/([^/]+)\/hollow\/([^/]+)$/, m => ({ family: 'quantity-hollow', id: m[3]!, secondId: m[1]!, unitId: m[2]! })],
  [/^\/base\/supplier\/credential\/([^/]+)$/, m => ({ family: 'supplier-credential', id: m[1]! })],
  [/^\/schedule\/process-library\/([^/]+)$/, m => ({ family: 'process-library', id: m[1]! })],
  [/^\/project\/target-cost\/([^/]+)$/, m => ({ family: 'target-cost', id: m[1]! })],
  [/^\/project\/([^/]+)\/supplier\/([^/]+)$/, m => ({ family: 'project-supplier', id: m[1]!, secondId: m[2]! })],
  [/^\/project\/([^/]+)$/, m => ({ family: 'project', id: m[1]! })],
  [/^\/base\/(customer|supplier|crew|worker)\/([^/]+)$/, m => ({ family: m[1]!, id: m[2]! })],
  [/^\/contract\/(other-expense|company-expense|other-settlement)\/([^/]+)$/, m => ({ family: m[1] === 'other-settlement' ? 'other-settlement' : 'auxiliary', kind: m[1]!.replaceAll('-', '_'), id: m[2]! })],
  [/^\/contract\/([^/]+)$/, m => ({ family: 'contract', id: m[1]! })],
  [/^\/owner\/(change|report|acceptance|final-settlement|penalty)\/([^/]+)$/, m => ({ family: 'owner-document', kind: m[1]!, id: m[2]! })],
  [/^\/subcontract\/(change|settlement)\/([^/]+)$/, m => ({ family: 'subcontract-document', kind: m[1]!, id: m[2]! })],
  [/^\/project\/penalty\/([^/]+)$/, m => ({ family: 'subcontract-document', kind: 'penalty', id: m[1]! })],
  [/^\/finance\/receipt\/([^/]+)$/, m => ({ family: 'receipt', id: m[1]! })],
  [/^\/material\/delivery\/archive\/([^/]+)$/, m => ({ family: 'delivery', id: m[1]! })],
  [/^\/finance\/payment\/([^/]+)\/detail$/, m => ({ family: 'unconnected', id: m[1]! })],
  [/^\/subcontract\/payroll\/([^/]+)$/, m => ({ family: 'payroll', kind: 'wage', id: m[1]! })],
  [/^\/subcontract\/payroll\/adjustments\/([^/]+)$/, m => ({ family: 'payroll-adjustment', id: m[1]! })],
  [/^\/subcontract\/payroll\/payments\/([^/]+)$/, m => ({ family: 'payroll-actual', id: m[1]! })],
  [/^\/subcontract\/quantity\/([^/]+)\/([^/]+)$/, m => ({ family: 'crew-worker-fact', kind: 'assignment', id: m[2]!, secondId: m[1]! })],
  [/^\/schedule\/([^/]+)$/, m => ({ family: 'unconnected', id: m[1]! })],
]

const LIST_QUERY = new Set(['origin', 'search', 'page', 'pageSize', 'sort', 'status', 'category', 'type', 'projectId', 'supplierId', 'customerId', 'contractId', 'project', 'supplier', 'customer', 'contract', 'phase', 'manager', 'plannedEnd', 'trade', 'crewId', 'crew', 'projectStatus', 'month', 'tab', 'variant', 'nav', 'returnTo', 'returnContext', 'credentialStatus', 'columnFilters', 'subKind', 'documentType', 'from', 'group', 'task', 'stage', 'item', 'building', 'buildings', 'groupName', 'taskName', 'itemName', 'planStart', 'planFinish', 'focus'])
const DETAIL_QUERY = new Set(['origin', 'contractKind', 'tab', 'variant', 'customerId', 'contractId', 'ownerKind', 'ownerId', 'focus', 'focusView', 'returnTo', 'returnContext', 'relationContext', 'nav'])
const WRITE_SEGMENTS = new Set(['new', 'form', 'edit', 'import', 'template', 'dev'])

function hasControlCharacters(value: string): boolean {
  return [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}

function parsePath(fullPath: string, depth = 0): { inspected: RestorableTabPath, url: URL, detail: RestoredDetailPath | null } | null {
  if (depth > 4 || fullPath.length > 131072 || !fullPath.startsWith('/') || fullPath.startsWith('//') || fullPath.includes('\\') || hasControlCharacters(fullPath))
    return null
  try {
    const rawPath = fullPath.split(/[?#]/)[0]!
    const segments = rawPath.split('/').map(decodeURIComponent)
    if (segments.some(segment => segment === '.' || segment === '..' || WRITE_SEGMENTS.has(segment) || segment.includes('\\') || hasControlCharacters(segment)))
      return null
    const url = new URL(fullPath, 'https://ruihang.invalid')
    if (url.origin !== 'https://ruihang.invalid' || url.pathname === PAYROLL_A_CONFIG_PATH)
      return null
    let detail: RestoredDetailPath | null = null
    if (!Object.hasOwn(LISTS, url.pathname)) {
      for (const [pattern, classify] of DETAIL_PATTERNS) {
        const matches = pattern.exec(url.pathname)
        if (matches) {
          detail = classify(matches)
          detail.id = decodeURIComponent(detail.id)
          if (detail.secondId)
            detail.secondId = decodeURIComponent(detail.secondId)
          if (detail.unitId)
            detail.unitId = decodeURIComponent(detail.unitId)
          break
        }
      }
      if (!detail)
        return null
      const validDetailId = detail.family === 'crew-worker-fact' && detail.kind === 'assignment'
        ? isQuantitySourceIdentity(detail.id, 'units')
        : detail.family === 'quantity-hollow'
          ? isQuantitySourceIdentity(detail.id, 'quantity_hollow_records') && isQuantitySourceIdentity(detail.unitId, 'units')
          : isStableRouteIdentity(detail.id)
      if (!validDetailId || (detail.secondId != null && !isStableRouteIdentity(detail.secondId)))
        return null
    }
    const originValue = url.searchParams.get('origin')
    if (url.searchParams.getAll('origin').length > 1 || (originValue != null && originValue !== 'real' && originValue !== 'demo'))
      return null
    const origin = originValue as DataOriginDTO | null ?? (detail ? 'real' : null)
    const baseAllowed = detail ? DETAIL_QUERY : LIST_QUERY
    const quantity = url.pathname === '/subcontract/quantity' || (detail?.family === 'crew-worker-fact' && detail.kind === 'assignment')
    const schedule = url.pathname === '/' || url.pathname === '/schedule'
    const allowed = new Set(quantity || schedule ? [...baseAllowed, ...QUANTITY_FILTER_KEYS, ...SCHEDULE_DRILL_QUERY_KEYS] : baseAllowed)
    if (detail?.family === 'quantity-hollow') {
      if (origin !== 'real' || ['ownerKind', 'ownerId'].some(key => url.searchParams.has(key)))
        return null
      if (url.searchParams.has('revisionId') && (url.searchParams.getAll('revisionId').length !== 1 || !isQuantitySourceIdentity(url.searchParams.get('revisionId'), 'quantity_hollow_revisions')))
        return null
      allowed.add('revisionId')
    }
    const paymentPayrollScope = url.pathname === '/finance/payment-management'
    if (paymentPayrollScope && url.searchParams.has('payrollProject')) {
      if (origin === 'demo' || url.searchParams.getAll('payrollProject').length !== 1 || !isStableRouteIdentity(url.searchParams.get('payrollProject')))
        return null
      allowed.add('payrollProject')
    }
    if (url.searchParams.get('payrollFormat') === 'C2') {
      const source: { kind: 'worker' | 'crew' | 'daywork', id: string, projectId?: string } | null = detail?.family === 'worker' || detail?.family === 'crew' ? { kind: detail.family, id: detail.id } : url.pathname === '/subcontract/daywork' ? { kind: 'daywork', id: url.searchParams.get('record') || '', projectId: url.searchParams.get('project') || '' } : null
      if (!origin || !source || PAYROLL_C2_SOURCE_KEYS.some(key => url.searchParams.getAll(key).length !== 1) || !payrollC2SourceContext(Object.fromEntries(url.searchParams), { ...source, origin }))
        return null
      PAYROLL_C2_SOURCE_KEYS.forEach(key => allowed.add(key))
    }
    else if (url.searchParams.has('payrollFormat')) {
      const source: { kind: 'worker' | 'crew' | 'attendance', id: string, projectId?: string } | null = detail?.family === 'worker' || detail?.family === 'crew' ? { kind: detail.family, id: detail.id } : url.pathname === '/subcontract/attendance' ? { kind: 'attendance', id: url.searchParams.get('record') || '', projectId: url.searchParams.get('project') || '' } : null
      if (!origin || !source || PAYROLL_C1_SOURCE_KEYS.some(key => url.searchParams.getAll(key).length !== 1) || !payrollC1SourceContext(Object.fromEntries(url.searchParams), { ...source, origin }))
        return null
      PAYROLL_C1_SOURCE_KEYS.forEach(key => allowed.add(key))
    }
    else if (PAYROLL_SOURCE_KEYS.some(key => url.searchParams.has(key) && !(paymentPayrollScope && key === 'payrollProject'))) {
      const sourceQuery = Object.fromEntries(url.searchParams)
      const source: { kind: PayrollSourceKind, id: string, projectId?: string } | null = detail?.family === 'crew-worker-fact' && detail.kind === 'assignment'
        ? { kind: 'quantity-unit' as const, id: detail.id, projectId: detail.secondId }
        : detail?.family === 'quantity-hollow'
          ? { kind: 'quantity-unit' as const, id: detail.unitId!, projectId: detail.secondId }
          : detail?.family === 'worker' || detail?.family === 'crew'
            ? { kind: detail.family, id: detail.id }
            : url.pathname === '/subcontract/quantity'
              ? { kind: 'quantity-project' as const, id: url.searchParams.get('project') || '', projectId: url.searchParams.get('project') || '' }
              : null
      if (!origin || !source || PAYROLL_SOURCE_KEYS.some(key => url.searchParams.getAll(key).length !== 1) || !payrollSourceContext(sourceQuery, { ...source, origin }))
        return null
      PAYROLL_SOURCE_KEYS.forEach(key => allowed.add(key))
    }
    if (detail?.family === 'crew-worker-fact' && detail.kind === 'assignment') {
      for (const [key, table] of [['stageId', 'construction_stages'], ['itemId', 'items'], ['completionId', 'unit_stage_completions']] as const) {
        if (url.searchParams.has(key) && (url.searchParams.getAll(key).length !== 1 || !isQuantitySourceIdentity(url.searchParams.get(key), table)))
          return null
        allowed.add(key)
      }
    }
    if (detail?.family === 'payroll' || ['/subcontract/payroll', '/subcontract/payroll/sources', '/subcontract/attendance', '/subcontract/daywork'].includes(url.pathname)) {
      const scope = payrollViewScope(Object.fromEntries([...url.searchParams.keys()].map(key => [key, url.searchParams.getAll(key).length > 1 ? url.searchParams.getAll(key) : url.searchParams.get(key)])))
      if (scope.error)
        return null
      if (scope.status)
        url.searchParams.set('status', scope.status)
      else
        url.searchParams.delete('status')
      PAYROLL_READ_QUERY_KEYS.forEach(key => allowed.add(key))
      if (url.pathname === '/subcontract/daywork') {
        if (url.searchParams.has('dayworkStatus')) {
          const statuses: unknown = JSON.parse(url.searchParams.get('dayworkStatus') || '[]')
          if (url.searchParams.getAll('dayworkStatus').length !== 1 || !Array.isArray(statuses) || statuses.some(status => status !== 'draft' && status !== 'confirmed'))
            return null
        }
        allowed.add('dayworkStatus')
      }
      if (url.pathname === '/subcontract/attendance' || url.pathname === '/subcontract/daywork') {
        for (const key of ['record', 'worker']) {
          if (url.searchParams.has(key) && (url.searchParams.getAll(key).length !== 1 || !isStableRouteIdentity(url.searchParams.get(key))))
            return null
          allowed.add(key)
        }
        if (url.searchParams.has('workDate') && (url.searchParams.getAll('workDate').length !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('workDate') || '')))
          return null
        allowed.add('workDate')
      }
    }
    if (url.pathname === TARGET_COST_LIST_PATH)
      TARGET_COST_FILTER_KEYS.forEach(key => allowed.add(key))
    if (url.pathname === '/subcontract/payroll/payments') {
      if (url.searchParams.has('statementId') && (url.searchParams.getAll('statementId').length !== 1 || !isStableRouteIdentity(url.searchParams.get('statementId'))))
        return null
      allowed.add('statementId')
    }
    if ((TARGET_COST_SOURCE_PATHS as readonly string[]).includes(url.pathname)) {
      const sourceQuery: Record<string, unknown> = Object.fromEntries(url.searchParams)
      if (TARGET_COST_SOURCE_QUERY_KEYS.some(key => url.searchParams.has(key))) {
        if (TARGET_COST_SOURCE_QUERY_KEYS.some(key => url.searchParams.getAll(key).length !== 1) || !targetCostSourceContext(url.pathname, sourceQuery))
          return null
        TARGET_COST_SOURCE_QUERY_KEYS.forEach(key => allowed.add(key))
      }
    }
    if (url.pathname === '/schedule') {
      for (const key of ['floorPlan', 'bindingContract', 'bindingLine']) {
        if (url.searchParams.has(key) && (url.searchParams.getAll(key).length !== 1 || !isStableRouteIdentity(url.searchParams.get(key))))
          return null
        allowed.add(key)
      }
    }
    for (const key of [...url.searchParams.keys()]) {
      if (!allowed.has(key) || url.searchParams.getAll(key).some(hasControlCharacters))
        url.searchParams.delete(key)
    }
    for (const key of ['contractKind', 'variant', 'customerId', 'contractId', 'ownerKind', 'ownerId', 'tab', 'focus', 'focusView', 'returnTo', 'returnContext', 'relationContext']) {
      if (url.searchParams.getAll(key).length > 1)
        return null
    }
    const returnTo = url.searchParams.get('returnTo')
    if (returnTo) {
      const nested = parsePath(returnTo, depth + 1)
      if (nested && (origin == null || nested.inspected.origin == null || nested.inspected.origin === origin))
        url.searchParams.set('returnTo', nested.inspected.fullPath)
      else
        url.searchParams.delete('returnTo')
    }
    if (url.hash && !/^#[\w%.:~-]+$/.test(url.hash))
      url.hash = ''
    return { inspected: { fullPath: `${url.pathname}${url.search}${url.hash}`, origin }, url, detail }
  }
  catch {
    return null
  }
}

export function inspectRestorableTabPath(fullPath: string): RestorableTabPath | null {
  return parsePath(fullPath)?.inspected ?? null
}

export function createTabRestoreValidator(options: { repositories: DomainRepositories, includeDemo: () => boolean, capabilities: () => readonly string[] }): TabRestoreValidator {
  return async (descriptor, signal) => {
    checkRestoreAbort(signal)
    if (descriptor.targetVersion !== TAB_TARGET_VERSION)
      return restoreProblem('stale')
    const parsed = parsePath(descriptor.fullPath)
    if (!parsed || parsed.inspected.origin !== descriptor.origin)
      return restoreProblem('mismatch')
    if (parsed.inspected.origin === 'demo' && (!options.includeDemo() || !options.capabilities().includes('demo:read')))
      return restoreProblem('forbidden')
    if (parsed.url.pathname === '/schedule' && parsed.inspected.origin != null) {
      const id = parsed.url.searchParams.get('project')
      if (!isStableRouteIdentity(id) || parsed.url.searchParams.getAll('project').length !== 1)
        return restoreProblem('mismatch')
      parsed.detail = { family: 'schedule-project', id }
    }
    if (!parsed.detail) {
      const [title, capability] = LISTS[parsed.url.pathname]!
      if (capability && !options.capabilities().includes(capability))
        return restoreProblem('forbidden')
      return { state: 'resolved', fullPath: parsed.inspected.fullPath, title, sourceVersion: null }
    }
    try {
      const result = await readRestoredDetail({ ...options, detail: parsed.detail, path: parsed.inspected, url: parsed.url, signal })
      checkRestoreAbort(signal)
      return result
    }
    catch (cause) {
      checkRestoreAbort(signal)
      const code = (cause as { problem?: { code?: string } })?.problem?.code
      return restoreProblem(code === 'not-found' ? 'not-found' : code === 'forbidden' ? 'forbidden' : code === 'stale-source' ? 'stale' : code === 'relationship-mismatch' || code === 'invalid-query' || code === 'invalid-response' ? 'mismatch' : 'error')
    }
  }
}
