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
  routeCount: number
  classification: string
}

function markdownCells(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1)
    .map(cell => cell.trim())
}

function auditDomainCounts(markdown: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('| `app/pages/'))
      continue
    const domain = markdownCells(line)[2]
    counts.set(domain, (counts.get(domain) ?? 0) + 1)
  }
  return counts
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
        routeCount: Number(cells[2]),
        classification: cells[5],
      }
    })
}

describe('read model contract coverage', () => {
  it('maps every audited production route to exactly one DTO domain', () => {
    expect(existsSync(CONTRACT_PATH)).toBe(true)

    const audit = auditDomainCounts(readFileSync(AUDIT_PATH, 'utf8'))
    const rows = contractRows(readFileSync(CONTRACT_PATH, 'utf8'))
    const mapped = new Map(rows.map(row => [row.domain, row.routeCount]))

    expect(rows).toHaveLength(20)
    expect(new Set(rows.map(row => row.code)).size).toBe(rows.length)
    expect(new Set(rows.map(row => row.domain)).size).toBe(rows.length)
    expect(mapped).toEqual(audit)
    expect(rows.reduce((sum, row) => sum + row.routeCount, 0)).toBe(128)
    for (const row of rows)
      expect(row.classification, row.domain).toMatch(/`[ABC](?:\+[ABC])?`/)
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
      '当前 5 条静态 seed 不得继续作为运行时 fallback',
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
