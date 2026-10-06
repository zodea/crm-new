import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const PROJECT_ROOT = process.cwd()
const AUDIT_PATH = join(PROJECT_ROOT, 'docs/design/runtime-reference-audit.md')
const CONTRACT_PATH = join(PROJECT_ROOT, 'docs/rewrite/READ-MODELS.md')
const DOCS_INDEX_PATH = join(PROJECT_ROOT, 'docs/README.md')
const A01_A03_AUTHORITIES = [
  'DESIGN-SYSTEM.md',
  'DATABASE.md',
  'ARCHITECTURE.md',
  'COMMANDS.md',
  'READ-MODELS.md',
  'NAVIGATION.md',
  'PUBLIC-SURFACES.md',
].map(file => join(PROJECT_ROOT, 'docs/rewrite', file))
const DIRECT_CONTRACT_PATHS = [
  ...A01_A03_AUTHORITIES,
  ...['README.md', 'interaction-style-references.md', 'kit-ui-component-specs.md'].map(file => join(PROJECT_ROOT, 'docs/design', file)),
  ...['0007-unified-visual-style-rounded-cards.md', '0008-adopt-shadcn-vue-on-unocss.md', '0009-vxe-table-as-datagrid-engine.md', '0011-redesign-application-shell.md', '0013-align-all-ui-to-online-design.md', '0014-full-page-entity-forms.md', '0016-overlay-composition-contract.md', '0020-browser-authority-and-demo-workspace-boundary.md', '0021-single-operator-windows-production-storage.md'].map(file => join(PROJECT_ROOT, 'docs/adr', file)),
  ...['base-crew.md', 'base-supplier.md', 'base-worker.md', 'contract-forms.md', 'core-contracts.md', 'finance-billing.md', 'finance-payment.md', 'finance-records.md', 'finance-reimbursement.md', 'material-delivery.md', 'material-management.md', 'owner-documents.md', 'project-info.md', 'project-supplier.md'].map(file => join(PROJECT_ROOT, 'docs/rewrite/pages', file)),
  ...['auxiliary-contracts.md', 'core-contract-and-boq.md', 'crew-worker-records.md', 'customer-records.md', 'finance-payment.md', 'local-backup-and-restore.md', 'local-customer-storage.md', 'local-data-migration.md', 'local-project-storage.md', 'local-supplier-storage.md', 'material-price-analysis.md', 'other-expense-settlement.md', 'project-start-and-schedule.md', 'receipt-registration.md', 'supplier-credential-review.md', 'worker-roster-archive.md'].map(file => join(PROJECT_ROOT, 'docs/guides', file)),
]

function documentAnchors(markdown: string): Set<string> {
  const anchors = new Set(
    [...markdown.matchAll(/<a\s+id="([^"]+)"/g)].map(match => match[1]),
  )
  const occurrences = new Map<string, number>()
  for (const match of markdown.matchAll(/^#{1,6}[ \t]+(\S.*)$/gm)) {
    const slug = match[1].trim()
      .replace(/<[^>]*>/g, '')
      .replace(/[`*_~]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '')
      .replace(/\s/g, '-')
    const occurrence = occurrences.get(slug) ?? 0
    anchors.add(occurrence === 0 ? slug : `${slug}-${occurrence}`)
    occurrences.set(slug, occurrence + 1)
  }
  return anchors
}

interface DomainContractRow {
  code: string
  domain: string
  projection: string
  authority: string
}

function markdownCells(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1)
    .map(cell => cell.trim())
}

function auditDomains(markdown: string): Set<string> {
  const domains = new Set<string>()
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('| `app/pages/'))
      continue
    const domain = markdownCells(line)[2]
    domains.add(domain)
  }
  return domains
}

function contractRows(markdown: string): DomainContractRow[] {
  return markdown
    .split(/\r?\n/)
    .filter(line => /^\| `[a-z][a-z-]+` \|/.test(line))
    .map((line) => {
      const cells = markdownCells(line)
      return {
        code: cells[0].replaceAll('`', ''),
        domain: cells[1],
        projection: cells[2],
        authority: cells[3],
      }
    })
}

describe('read model contract coverage', () => {
  it.each(DIRECT_CONTRACT_PATHS)('keeps local authority links and retained anchors resolvable: %s', (path) => {
    const markdown = readFileSync(path, 'utf8')
    for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
      const href = match[1]
      if (/^(?:https?:|mailto:|app:|codex:|plugin:)/.test(href))
        continue
      const [relativePath, fragment] = href.split('#')
      const target = relativePath ? resolve(dirname(path), decodeURIComponent(relativePath)) : path
      expect(existsSync(target), `${path} → ${href}`).toBe(true)
      if (fragment && target.endsWith('.md')) {
        expect(documentAnchors(readFileSync(target, 'utf8')).has(decodeURIComponent(fragment)), `${path} → ${href}`).toBe(true)
      }
    }
  })

  it('maps every audited production route to exactly one DTO domain', () => {
    expect(existsSync(CONTRACT_PATH)).toBe(true)

    const audit = auditDomains(readFileSync(AUDIT_PATH, 'utf8'))
    const rows = contractRows(readFileSync(CONTRACT_PATH, 'utf8'))
    const mapped = new Set(rows.map(row => row.domain))

    expect(audit.size).toBeGreaterThan(0)
    expect(rows).toHaveLength(audit.size)
    expect(new Set(rows.map(row => row.code)).size).toBe(rows.length)
    expect(new Set(rows.map(row => row.domain)).size).toBe(rows.length)
    expect(mapped).toEqual(audit)
    for (const row of rows) {
      expect(row.projection.length, row.domain).toBeGreaterThan(0)
      expect(row.authority, row.domain).toMatch(/\]\([^)]+\.md(?:#[^)]+)?\)/)
    }
  })

  it.each([
    'type OpaqueIdDTO = string',
    'type DecimalDTO = string',
    'type MoneyDTO = DecimalDTO',
    'state: \'resolved\'',
    'state: \'missing\'',
    'state: \'forbidden\'',
    'reason: \'no-records\' | \'no-filter-match\' | \'missing-relation\'',
    'type ReadState<T> =',
    '\'relationship-mismatch\'',
    '\'stale-source\'',
    'sourceVersion: string | null',
    'interface AuthorizedScopeDTO',
    'type CompletenessDTO =',
    'knownValue:',
  ])('defines identity, decimal, empty, permission and error semantics: %s', (token) => {
    const contract = readFileSync(CONTRACT_PATH, 'utf8')
    expect(contract.replace(/\s+/g, ' ').includes(token.replace(/\s+/g, ' ')), token).toBe(true)
  })

  it.each([
    'interface InsightDTO<Row = Record<string, unknown>>',
    '| \'enterprise-visible\'',
    'result: \'passed\' | \'failed\' | \'no-rule\' | \'not-applicable\' | \'pending\'',
    'coverage: \'complete\' | \'permission-filtered\' | \'unknown\'',
    'NotificationOpenResultDTO',
    '通知事件身份、业务问题状态和已读状态分开',
    '读取接口不修改 readAt',
    '[PUBLIC-SURFACES](./PUBLIC-SURFACES.md#4-全局审批与抄送消息)',
  ])('defines cross-scope insight and real notification event contracts: %s', (token) => {
    const contract = readFileSync(CONTRACT_PATH, 'utf8')
    expect(contract.includes(token), token).toBe(true)
  })

  it('is linked from the canonical docs index', () => {
    expect(readFileSync(DOCS_INDEX_PATH, 'utf8')).toContain(
      '[`docs/rewrite/READ-MODELS.md`](./rewrite/READ-MODELS.md)',
    )
  })
})
