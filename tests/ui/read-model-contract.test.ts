import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PROJECT_ROOT = process.cwd()
const AUDIT_PATH = join(PROJECT_ROOT, 'docs/design/runtime-reference-audit.md')
const CONTRACT_PATH = join(PROJECT_ROOT, 'docs/rewrite/READ-MODELS.md')
const DOCS_INDEX_PATH = join(PROJECT_ROOT, 'docs/README.md')

interface DomainContractRow {
  code: string
  domain: string
  classification: string
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
        classification: cells[4],
      }
    })
}

describe('read model contract coverage', () => {
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
    for (const row of rows)
      expect(row.classification, row.domain).toMatch(/`[ABC](?:\+[ABC]){0,2}`/)
  })

  it('defines identity, decimal, empty, permission and error semantics', () => {
    const contract = readFileSync(CONTRACT_PATH, 'utf8')

    for (const token of [
      'type OpaqueIdDTO = string',
      'type MoneyDTO = string',
      'state: \'resolved\'',
      'state: \'missing\'',
      'state: \'forbidden\'',
      'reason: \'no-records\' | \'no-filter-match\' | \'missing-relation\'',
      'type ReadState<T> =',
      '\'relationship-mismatch\'',
      '\'stale-source\'',
      'sourceVersion: string | null',
      '禁止新增 MockJS',
    ]) {
      expect(contract, token).toContain(token)
    }
  })

  it('defines cross-scope insight and real notification event contracts', () => {
    const contract = readFileSync(CONTRACT_PATH, 'utf8')

    for (const token of [
      'interface InsightDTO<Row = Record<string, unknown>>',
      '| \'enterprise-visible\'',
      'result: \'passed\' | \'failed\' | \'no-rule\' | \'not-applicable\' | \'pending\'',
      'visibility: \'complete\' | \'permission-filtered\' | \'unknown\'',
      'interface NotificationDTO',
      'eventId: OpaqueIdDTO',
      'readAt: string | null',
      'deliveryState: \'queued\' | \'delivered\' | \'failed\'',
      '当前静态样本只在授权后的演示模式可见，正式来源保持真实空态',
      '不将样本作为正式运行 fallback',
      '`subject.id + sourceVersion`',
      '`report.key + 可见范围 + asOf + sourceVersion`',
    ]) {
      expect(contract, token).toContain(token)
    }
  })

  it('is linked from the canonical docs index', () => {
    expect(readFileSync(DOCS_INDEX_PATH, 'utf8')).toContain(
      '[`docs/rewrite/READ-MODELS.md`](./rewrite/READ-MODELS.md)',
    )
  })
})
