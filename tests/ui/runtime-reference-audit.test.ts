import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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

describe('runtime reference audit contract', () => {
  it('recomputes one current evidence record for every production route and page domain', () => {
    const ledger = buildRuntimeEvidenceLedger()
    const committed = JSON.parse(readFileSync(RUNTIME_EVIDENCE_LEDGER_PATH, 'utf8'))

    expect(committed).toEqual(ledger)
    expect(ledger.counts).toMatchObject({
      trackedPageFiles: 142,
      devPageFiles: 5,
      productionRoutes: 137,
      pageDomains: 20,
      evidenceEndpointRecords: 137,
      referenceEndpoints: 137,
      referenceProfiles: 41,
      usedReferenceProfiles: 35,
      directEvidenceRoutes: 54,
      adjacentEvidenceRoutes: 18,
      localAuthorityRoutes: 22,
      historicalEvidenceRoutes: 34,
      unverifiedTargetRoutes: 9,
    })
    expect(ledger.endpoints).toHaveLength(137)
    expect(ledger.domains).toHaveLength(20)

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
    expect(new Set(ledger.endpoints.filter(endpoint => endpoint.evidenceGrade === 'unverified-target').map(endpoint => endpoint.referenceProfile))).toEqual(new Set(['R-TOOL-PENDING']))
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

  it('keeps design authority and implementation status aligned with the generated ledger', () => {
    const ledger = buildRuntimeEvidenceLedger()
    const status = readFileSync(STATUS_PATH, 'utf8')
    const designIndex = readFileSync(DESIGN_INDEX_PATH, 'utf8')
    const coverage = JSON.parse(readFileSync(COVERAGE_PATH, 'utf8'))
    const designPending = coverage.screenParity.filter((entry: { status: string }) => entry.status === 'design-pending')

    expect(status).toContain('> 核对日期：2026-08-25')
    expect(status).toContain('| 实现页面文件（含 dev） | 142 |')
    expect(status).toContain('| 开发预览路由 | 5 |')
    expect(status).toContain('| 实现生产路由（排除 dev） | 137 |')
    expect(status).toContain('**当前为 2。**')
    expect(status).toContain('`/finance/payment/:id/detail`')
    expect(status).not.toMatch(/\| 已闭环 \|/)

    expect(designPending).toEqual([
      expect.objectContaining({
        appRoute: '/finance/payment/:id/detail',
        issue: '#305',
      }),
      expect.objectContaining({
        appRoute: '/settings/data-migration',
        issue: '#294',
      }),
    ])
    expect(designIndex).toContain('[#292](https://github.com/zodea/crm-new/issues/292)')
    expect(designIndex).toContain('[#276](https://github.com/zodea/crm-new/issues/276)')
    expect(designIndex).toContain('`/finance/payment/:id/detail`')
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
    expect(new Set(endpoints.map(endpoint => endpoint.evidenceRecordId)).size).toBe(137)
    expect(new Set(endpoints.map(endpoint => endpoint.page)).size).toBe(137)
    expect(new Set(endpoints.map(endpoint => endpoint.localRoute)).size).toBe(137)
    expect(new Set(endpoints.map(endpoint => endpoint.referenceEndpointId)).size).toBe(137)
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
