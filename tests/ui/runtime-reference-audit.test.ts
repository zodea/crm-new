import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildRuntimeEvidenceLedger,
  IMPLEMENTATION_FRONTIER_BLOCK_BEGIN,
  IMPLEMENTATION_FRONTIER_BLOCK_END,
  renderImplementationFrontier,
  renderRuntimeEvidenceSummary,
  RUNTIME_EVIDENCE_LEDGER_PATH,
  RUNTIME_SUMMARY_BLOCK_BEGIN,
  RUNTIME_SUMMARY_BLOCK_END,
} from '../../scripts/runtime-evidence-ledger.mjs'

const PROJECT_ROOT = process.cwd()
const AUDIT_PATH = join(PROJECT_ROOT, 'docs/design/runtime-reference-audit.md')
const COVERAGE_PATH = join(PROJECT_ROOT, 'docs/design/design-coverage.json')
const DESIGN_INDEX_PATH = join(PROJECT_ROOT, 'docs/design/README.md')
const STATUS_PATH = join(PROJECT_ROOT, 'docs/design/ui-implementation-status.md')
const PAGE_TEMPLATES = new Set(['列表', '详情', '整页表单', '工作台', '特殊工具'])

function pageFiles(directory = join(PROJECT_ROOT, 'app/pages')): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? pageFiles(join(directory, entry.name))
    : entry.name.endsWith('.vue')
      ? [relative(PROJECT_ROOT, join(directory, entry.name)).replaceAll('\\', '/')]
      : [])
}

function markdownCells(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1)
    .map(cell => cell.trim())
}

function definedProfileCodes(markdown: string, prefix: 'R-' | 'C-'): Set<string> {
  return new Set(markdown
    .split(/\r?\n/)
    .filter(line => line.startsWith(`| \`${prefix}`))
    .map(line => markdownCells(line)[0].replaceAll('`', '')))
}

function generatedBlock(markdown: string, begin: string, end: string): string {
  const from = markdown.indexOf(begin)
  const to = markdown.indexOf(end)
  expect(from, begin).toBeGreaterThanOrEqual(0)
  expect(to, end).toBeGreaterThan(from)
  return markdown.slice(from + begin.length, to).trim().replaceAll('\r\n', '\n')
}

function markdownSection(markdown: string, heading: string, nextHeading: string): string {
  const start = markdown.indexOf(heading)
  const end = markdown.indexOf(nextHeading, start + heading.length)

  expect(start, heading).toBeGreaterThanOrEqual(0)
  expect(end, nextHeading).toBeGreaterThan(start)

  return markdown.slice(start, end)
}

// 仅验证参考证据登记及生成物同步；路由数和证据等级不证明任何工资业务通过。
describe('运行参考文档与生成物一致性（非业务验收）', () => {
  it('routes current review work to the new map without losing historical evidence', () => {
    const ledger = buildRuntimeEvidenceLedger()
    const endpoint = (route: string) => ledger.endpoints.find(item => item.localRoute === route)!

    expect(endpoint('/base/supplier').implementationIssues).toEqual([407])
    expect(endpoint('/base/supplier').historicalImplementationIssues).toEqual([281, 289])
    expect(endpoint('/material/settlement').implementationIssues).toEqual([409])
    expect(endpoint('/material/arrival').implementationIssues).toEqual([411])
    expect(endpoint('/import/mapping/:entity').implementationIssues).toEqual([406])
    expect(endpoint('/settings/data-migration').implementationIssues).toEqual([414])
    expect(endpoint('/finance/invoice/factor').implementationIssues).toEqual([413, 414])
    expect(endpoint('/finance/payment/:id/detail').implementationIssues).toEqual([413, 404])
    expect(endpoint('/finance/payment/:id/detail').evidenceGrade).toBe('adjacent')
    expect(ledger.domains.find(domain => domain.code === 'import-export')?.implementationIssues).toEqual([406, 414])
    expect(ledger.endpoints.every(item => item.implementationIssues.every(issue => issue >= 403 && issue <= 416))).toBe(true)
  })

  it('recomputes one current evidence record for every production route and page domain', () => {
    const ledger = buildRuntimeEvidenceLedger()
    const committed = JSON.parse(readFileSync(RUNTIME_EVIDENCE_LEDGER_PATH, 'utf8'))

    expect(committed).toEqual(ledger)
    const files = pageFiles()
    const productionFiles = files.filter(file => !file.startsWith('app/pages/dev/'))
    const audit = readFileSync(AUDIT_PATH, 'utf8')
    const rows = audit.split(/\r?\n/).filter(line => line.startsWith('| `app/pages/')).map(markdownCells)
    const domains = readFileSync(join(PROJECT_ROOT, 'docs/rewrite/READ-MODELS.md'), 'utf8')
      .split(/\r?\n/)
      .filter(line => /^\| `[a-z][a-z-]+` \|/.test(line))
      .map(line => markdownCells(line)[0].replaceAll('`', ''))
    expect(new Set(rows.map(row => row[0].replaceAll('`', '')))).toEqual(new Set(productionFiles))
    expect(new Set(ledger.endpoints.map(endpoint => endpoint.page))).toEqual(new Set(productionFiles))
    expect(new Set(ledger.domains.map(domain => domain.code))).toEqual(new Set(domains))
    expect(ledger.counts).toMatchObject({
      trackedPageFiles: files.length,
      devPageFiles: files.length - productionFiles.length,
      productionRoutes: productionFiles.length,
      pageDomains: domains.length,
      evidenceEndpointRecords: rows.length,
      referenceEndpoints: new Set(ledger.endpoints.map(endpoint => endpoint.referenceEndpointId)).size,
      referenceProfiles: definedProfileCodes(audit, 'R-').size,
      usedReferenceProfiles: new Set(rows.map(row => row[5].replaceAll('`', ''))).size,
    })
    expect(ledger.endpoints).toHaveLength(rows.length)
    expect(ledger.domains).toHaveLength(domains.length)
    for (const [count, grade] of [
      ['directEvidenceRoutes', 'direct'],
      ['adjacentEvidenceRoutes', 'adjacent'],
      ['localAuthorityRoutes', 'local-authority'],
      ['historicalEvidenceRoutes', 'historical'],
      ['unverifiedTargetRoutes', 'unverified-target'],
    ] as const)
      expect(ledger.counts[count]).toBe(ledger.endpoints.filter(endpoint => endpoint.evidenceGrade === grade).length)

    for (const endpoint of ledger.endpoints) {
      expect(endpoint.evidenceRecordId).toMatch(/^E-[0-9A-F]{12}$/)
      expect(endpoint.referenceEndpointId).not.toBe('')
      expect(endpoint.referenceEndpointLabel).not.toBe('')
      expect(endpoint.evidenceGrade).toMatch(/^(direct|adjacent|historical|unverified-target|local-authority)$/)
      expect(endpoint.observationDate === null || /^\d{4}-\d{2}-\d{2}$/.test(endpoint.observationDate)).toBe(true)
      expect(endpoint.observationDateStatus).toMatch(/^(recorded|not-recorded-historical|not-observed|not-applicable-local-authority)$/)
      expect(endpoint.permissionStatus).toMatch(/^(read-only-observed|read-only-observed-with-restricted-target|unverified|not-applicable)$/)
      expect(endpoint.implementationIssues.length).toBeGreaterThan(0)
      expect(endpoint.layoutConclusion).toEqual({
        sourceDocument: 'docs/design/runtime-reference-audit.md',
        routeKey: endpoint.localRoute,
      })
      expect(endpoint.stateAndNavigationConclusion).toEqual(endpoint.layoutConclusion)
    }

    expect(ledger.endpoints.filter(endpoint => endpoint.permissionStatus === 'read-only-observed-with-restricted-target').map(endpoint => endpoint.localRoute)).toEqual([
      '/base/customer',
      '/project',
    ])
    expect(ledger.endpoints.filter(endpoint => endpoint.evidenceGrade === 'adjacent').map(endpoint => endpoint.localRoute)).toEqual([
      '/base/supplier/form/:id?',
      '/contract/material/form/:id',
      '/finance/invoice',
      '/finance/payment/:id/detail',
      '/material/settlement/form/:id',
      '/owner/:kind/:id',
      '/owner-material/arrival/:id',
      '/owner-material/arrival/new',
      '/owner-material/control/:id',
      '/owner-material/control/new',
      '/owner-material/direct/:id',
      '/owner-material/direct/new',
      '/owner-material/requisition/:id',
      '/owner-material/requisition/new',
      '/owner-material/use/:id',
      '/owner-material/use/new',
      '/project/:pid/supplier/:sid',
      '/project/:pid/supplier/import',
    ])
    expect(new Set(ledger.endpoints.filter(endpoint => endpoint.evidenceGrade === 'historical').map(endpoint => endpoint.referenceProfile))).toEqual(new Set([
      'R-LIST-PRIOR',
      'R-FORM-PRIOR',
      'R-DETAIL-PRIOR',
      'R-WORKBENCH-PRIOR',
    ]))
    expect(new Set(ledger.endpoints.filter(endpoint => endpoint.evidenceGrade === 'unverified-target').map(endpoint => endpoint.referenceProfile))).toEqual(new Set(['R-TOOL-PENDING', 'R-STAGE-PENDING']))
    expect(ledger.endpoints.filter(endpoint => endpoint.observationDate === null).every(endpoint => endpoint.observationDateStatus !== 'recorded')).toBe(true)

    expect(ledger.endpoints.filter(endpoint => [
      '/finance/payment',
      '/finance/payment-management',
      '/finance/records',
    ].includes(endpoint.localRoute)).map(endpoint => ({
      evidenceRecordId: endpoint.evidenceRecordId,
      referenceEndpointId: endpoint.referenceEndpointId,
      referenceEndpointLabel: endpoint.referenceEndpointLabel,
    }))).toEqual([
      {
        evidenceRecordId: 'E-7C0131CDBA56',
        referenceEndpointId: 'finance-payment-list',
        referenceEndpointLabel: '资金管理 > 付款申请',
      },
      {
        evidenceRecordId: 'E-45B4B7708E6F',
        referenceEndpointId: 'finance-payment-management',
        referenceEndpointLabel: '资金管理 > 付款管理',
      },
      {
        evidenceRecordId: 'E-C2DAF212F5DF',
        referenceEndpointId: 'finance-payment-records',
        referenceEndpointLabel: '资金管理 > 支付记录',
      },
    ])
  })

  it('keeps all seven P4 routes on local authority until separately recorded evidence exists', () => {
    const entries = buildRuntimeEvidenceLedger().endpoints.filter(endpoint => endpoint.referenceProfile === 'R-PAYROLL-ADJUSTMENTS-LOCAL')
    expect(entries).toHaveLength(7)
    expect(entries.every(endpoint => endpoint.evidenceGrade === 'local-authority' && endpoint.observationDate === null && endpoint.observationDateStatus === 'not-applicable-local-authority' && endpoint.permissionStatus === 'not-applicable')).toBe(true)
    expect(entries.every(endpoint => endpoint.implementationIssues.length === 1 && endpoint.implementationIssues[0] === 412)).toBe(true)
  })

  it('keeps design authority and implementation status aligned with the generated ledger', () => {
    const ledger = buildRuntimeEvidenceLedger()
    const status = readFileSync(STATUS_PATH, 'utf8')
    const designIndex = readFileSync(DESIGN_INDEX_PATH, 'utf8')
    const coverage = JSON.parse(readFileSync(COVERAGE_PATH, 'utf8'))
    const designPending = coverage.screenParity.filter((entry: { status: string }) => entry.status === 'design-pending')

    expect(status).toContain(`> 核对日期：${ledger.auditedAt}`)
    expect(status).toContain(`| 实现页面文件（含 dev） | ${ledger.counts.trackedPageFiles} |`)
    expect(status).toContain(`| 开发预览路由 | ${ledger.counts.devPageFiles} |`)
    expect(status).toContain(`| 实现生产路由（排除 dev） | ${ledger.counts.productionRoutes} |`)
    expect(status).toContain('`/finance/payment/:id/detail`')
    expect(status).not.toMatch(/\| 已闭环 \|/)

    expect(designPending).toEqual([
      expect.objectContaining({
        appRoute: '/base/worker/private/:id',
        issue: '#449',
      }),
      expect.objectContaining({
        appRoute: '/contract/boq/building-evidence',
        issue: '#445',
      }),
      expect.objectContaining({ appRoute: '/contract/other-settlement/import', designRoute: null, status: 'design-pending', issue: '#411', reason: expect.stringContaining('没有直接外部参考页或DC注册') }),
      expect.objectContaining({ appRoute: '/material/quotations', designRoute: null, status: 'design-pending', issue: '#411', reason: expect.stringContaining('DC实际注册尚无对应独立屏') }),
      expect.objectContaining({ appRoute: '/material/quotations/:id', designRoute: null, status: 'design-pending', issue: '#411', reason: expect.stringContaining('DC实际注册尚无对应独立屏') }),
      expect.objectContaining({ appRoute: '/material/quotations/form/:id?', designRoute: null, status: 'design-pending', issue: '#411', reason: expect.stringContaining('DC实际注册尚无对应独立屏') }),
      expect.objectContaining({ appRoute: '/material/quotations/import', designRoute: null, status: 'design-pending', issue: '#411', reason: expect.stringContaining('DC实际注册尚无对应独立屏') }),
      expect.objectContaining({ appRoute: '/settings/our-signatories', designRoute: null, status: 'design-pending', reason: expect.stringContaining('DC 未注册') }),
      expect.objectContaining({ appRoute: '/settings/our-signatories/form/:id?', designRoute: null, status: 'design-pending', reason: expect.stringContaining('DC 未注册') }),
      expect.objectContaining({
        appRoute: '/subcontract/daywork/form/:id',
        issue: '#412',
      }),
      expect.objectContaining({
        appRoute: '/subcontract/daywork/new',
        issue: '#412',
      }),
      expect.objectContaining({
        appRoute: '/subcontract/payroll/adjustments/:id',
        issue: '#412',
      }),
      expect.objectContaining({
        appRoute: '/subcontract/payroll/adjustments/form/:id',
        issue: '#412',
      }),
      expect.objectContaining({
        appRoute: '/subcontract/payroll/adjustments/new',
        issue: '#412',
      }),
      expect.objectContaining({
        appRoute: '/subcontract/payroll/config',
        issue: '#412',
      }),
      expect.objectContaining({
        appRoute: '/subcontract/payroll/form/:id',
        issue: '#412',
      }),
      expect.objectContaining({
        appRoute: '/subcontract/payroll/issue/:id',
        issue: '#477',
      }),
      expect.objectContaining({
        appRoute: '/subcontract/payroll/payments',
        issue: '#412',
      }),
      expect.objectContaining({
        appRoute: '/subcontract/payroll/payments/:id',
        issue: '#412',
      }),
      expect.objectContaining({
        appRoute: '/subcontract/payroll/payments/new',
        issue: '#412',
      }),
      expect.objectContaining({
        appRoute: '/subcontract/payroll/payments/reversal/new',
        issue: '#412',
      }),
      expect.objectContaining({
        appRoute: '/subcontract/payroll/roster',
        issue: '#449',
      }),
      expect.objectContaining({
        appRoute: '/subcontract/payroll/sources',
        issue: '#412',
      }),
      expect.objectContaining({
        appRoute: '/subcontract/payroll/workbooks',
        issue: '#479',
      }),
      expect.objectContaining({
        appRoute: '/subcontract/quantity/:pid/:uid/hollow/:id',
        issue: '#412',
      }),
      expect.objectContaining({
        appRoute: '/subcontract/quantity/:pid/:uid/hollow/form/:id',
        issue: '#412',
      }),
      expect.objectContaining({
        appRoute: '/subcontract/quantity/:pid/:uid/hollow/new',
        issue: '#412',
      }),
    ])
    expect(designIndex).toContain('[#292](https://github.com/zodea/crm-new/issues/292)')
    expect(designIndex).toContain('[#276](https://github.com/zodea/crm-new/issues/276)')
    expect(designIndex).toContain('](./ui-implementation-status.md)')
    expect(designIndex).not.toContain('**当前为空。**')

    expect(generatedBlock(status, IMPLEMENTATION_FRONTIER_BLOCK_BEGIN, IMPLEMENTATION_FRONTIER_BLOCK_END)).toBe(
      renderImplementationFrontier(ledger),
    )
    expect(generatedBlock(readFileSync(AUDIT_PATH, 'utf8'), RUNTIME_SUMMARY_BLOCK_BEGIN, RUNTIME_SUMMARY_BLOCK_END)).toBe(
      renderRuntimeEvidenceSummary(ledger),
    )

    const currentIssues = new Set(ledger.domains.flatMap(domain => domain.implementationIssues))
    for (const issue of currentIssues)
      expect(status, `#${issue}`).toContain(`issues/${issue}`)
  })

  it('keeps one uniquely identified evidence endpoint for every production route', () => {
    expect(existsSync(AUDIT_PATH)).toBe(true)

    const endpoints = buildRuntimeEvidenceLedger().endpoints
    expect(new Set(endpoints.map(endpoint => endpoint.page))).toEqual(new Set(pageFiles().filter(file => !file.startsWith('app/pages/dev/'))))
    for (const key of ['evidenceRecordId', 'page', 'localRoute', 'referenceEndpointId'] as const)
      expect(new Set(endpoints.map(endpoint => endpoint[key])).size, key).toBe(endpoints.length)
  })

  it('records classification, evidence, differences and constraints for each route', () => {
    const markdown = readFileSync(AUDIT_PATH, 'utf8')
    const references = definedProfileCodes(markdown, 'R-')
    const constraints = definedProfileCodes(markdown, 'C-')

    for (const endpoint of buildRuntimeEvidenceLedger().endpoints) {
      expect(endpoint.localRoute, endpoint.page).toMatch(/^\//)
      expect(endpoint.domainCode, endpoint.page).not.toBe('')
      expect(PAGE_TEMPLATES.has(endpoint.template), endpoint.page).toBe(true)
      expect(endpoint.implementationIssues.every(Number.isInteger), endpoint.page).toBe(true)
      expect(references.has(endpoint.referenceProfile), endpoint.page).toBe(true)
      expect(constraints.has(endpoint.constraints), endpoint.page).toBe(true)
    }
  })

  it('保留我方主体目录与整页表单的真实注册，不捏造历史实施票或设计覆盖', () => {
    const endpoints = buildRuntimeEvidenceLedger().endpoints
    for (const route of ['/settings/our-signatories', '/settings/our-signatories/form/:id?']) {
      const endpoint = endpoints.find(item => item.localRoute === route)!
      expect(endpoint.domainCode).toBe('ocr-settings')
      expect(endpoint.historicalImplementationIssues).toEqual([])
      expect(endpoint.implementationIssues).toEqual([414])
      expect(endpoint.evidenceGrade).not.toBe('direct')
      const coverage = JSON.parse(readFileSync(COVERAGE_PATH, 'utf8')).screenParity.find((item: { appRoute: string }) => item.appRoute === route)
      expect(coverage).toMatchObject({ status: 'design-pending', designRoute: null })
      expect(coverage.reason).toContain('DC 未注册')
    }
  })

  it('defines safe evidence, discrepancy and needs-info protocols', () => {
    const markdown = readFileSync(AUDIT_PATH, 'utf8')
    const boundary = markdownSection(markdown, '## 1. 裁定边界', '## 2. 严格只读观察协议')
    const safeObservation = markdownSection(markdown, '## 2. 严格只读观察协议', '## 3. 参考证据档案')
    const needsInfoTemplate = safeObservation.match(/### needs-info 固定模板\s+```md\r?\n([\s\S]+?)\r?\n```/)?.[1]

    expect(needsInfoTemplate?.match(/^## .+$/gm)).toEqual([
      '## Reference behavior',
      '## Current app behavior',
      '## Decision requested',
      '## Safe default',
    ])
    expect(safeObservation).toMatch(/裁剪脱敏图或重绘线框/)
    expect(safeObservation).toMatch(/截图必须移除[^。\n]*真实客户、项目、人员、金额或单据数据/)
    expect(safeObservation).toMatch(/打开空白新建页核对后直接关闭\/取消/)
    expect(safeObservation).toMatch(/不得录入、粘贴、上传、选择业务对象、保存、提交/)
    expect(safeObservation).toMatch(/禁止修改、删除、下载、导出、审批/)
    expect(boundary).toMatch(/#181[\s\S]+通过 #183 并入设计权威链/)
    expect(boundary).toMatch(/#110[\s\S]+历史解释力/)
    expect(boundary).toMatch(/双源边界/)
  })
})
