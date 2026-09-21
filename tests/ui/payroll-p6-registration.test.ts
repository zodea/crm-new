import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { buildModuleReviewCoverage } from '../../scripts/module-review-coverage.mjs'

const productCommit = 'edc03faba20e0c5c665b7fc2011e2a4120d8428f'
const evidence = 'docs/design/evidence/issue-412-payroll-hollow/README.md'
const hollowCases = ['C-D6CAD39409A2', 'C-1785D3BD0ACB', 'C-646DC1829859']
const reportDirectory = 'docs/research/issue-review-2026-09-11'

interface ReportNode {
  id: string
  title: string
  lines: string[]
}
interface ReportRow {
  number: number
  status: string
  solved: string[]
  remaining: string[]
  evidence: string[]
  questions: string[]
  screens: Array<{ title: string }>
  graph: { nodes: ReportNode[], edges: unknown[] }
}

describe('p6 limited delivery registration', () => {
  it('binds the fixed product evidence to the hollow obligation and keeps P7 and production open', () => {
    const coverage = buildModuleReviewCoverage()
    const byId = (id: string) => coverage.obligations.find(item => item.id === id)!
    expect(byId('WAGE-15')).toMatchObject({ status: 'current-passed' })
    expect(byId('WAGE-15').evidence).toContainEqual(expect.objectContaining({ reference: evidence, commit: productCommit, recency: 'current-run' }))
    expect(byId('WAGE-15').remaining).toContain('local grill')
    expect(byId('WAGE-18')).toMatchObject({ status: 'partial' })
    expect(byId('WAGE-18').evidence).toContainEqual(expect.objectContaining({ reference: evidence, commit: productCommit }))
    expect(byId('WAGE-18').remaining).toContain('P7')
    for (const id of ['WAGE-16', 'WAGE-17']) {
      expect(byId(id).status).toBe('ready')
      expect(byId(id).evidence).toEqual([])
    }
    expect(new Set(byId('WAGE-15').caseIds).size).toBe(byId('WAGE-15').caseIds.length)
    for (const caseId of hollowCases) {
      const current = coverage.cases.find(item => item.id === caseId)!
      expect(current).toMatchObject({ host: 'browser', adapter: 'central-http', acceptance: { rules: 'scoped-defined', frontend: 'passed', crossModule: 'passed', production: 'not-verified' } })
      expect(current.reviewEvidence).toContain(evidence)
      expect(current.obligationIds).toContain('WAGE-15')
    }
    expect(coverage.counts).toMatchObject({ productionRoutes: 155, rootVariants: 211, surfaces: 757, environmentCases: 1227 })
  })

  it('keeps #412 partial, renders P6 evidence and preserves the seven real business questions', () => {
    const rows: ReportRow[] = JSON.parse(readFileSync(`${reportDirectory}/rows-business.json`, 'utf8'))
    const row = rows.find(item => item.number === 412)!
    const dom = new JSDOM(readFileSync(`${reportDirectory}/index.html`, 'utf8'))
    try {
      const embedded: ReportRow[] = JSON.parse(dom.window.document.querySelector('#review-data')!.textContent!)
      const rendered = embedded.find(item => item.number === 412)!
      expect(embedded).toHaveLength(46)
      expect(embedded.filter(item => item.status === 'local-done')).toHaveLength(31)
      expect(embedded.filter(item => item.status === 'partial')).toHaveLength(14)
      expect(embedded.filter(item => item.status === 'decision')).toHaveLength(1)
      expect(row.status).toBe('partial')
      expect(rendered).toEqual(expect.objectContaining(row))
      expect(row.solved.join('\n')).toContain(productCommit)
      expect(row.solved.join('\n')).toContain('782文件4312项')
      expect(row.remaining.join('\n')).toContain('P7')
      expect(row.remaining.join('\n')).toContain('grill')
      expect(row.questions).toHaveLength(7)
      expect(row.questions[3]).toContain('P6 空鼓')
      expect(row.evidence).toContain(evidence)
      expect(row.screens.some(item => item.title.startsWith('P6户级空鼓'))).toBe(true)
      expect(row.graph.nodes).toHaveLength(18)
      expect(row.graph.edges).toHaveLength(27)
      expect(row.graph.nodes.find(item => item.id === 'a')!.lines).toContain('独立管理簿 / 负价；户级空鼓人工扣款')
      expect(row.graph.nodes.find(item => item.id === 'end')!.title).toContain('P7')
      expect(row.graph.nodes.find(item => item.id === 'end')!.lines).toContain('批量资金、完整工作簿与名册继续实施')
      for (const path of row.evidence.filter(item => item.includes('payroll-hollow')))
        expect(existsSync(resolve(path))).toBe(true)
      const summary = readFileSync(`${reportDirectory}/README.md`, 'utf8').split(/\r?\n/).find(line => line.startsWith('| [#412 '))!
      expect(summary).toContain(productCommit)
      expect(summary).toContain('部分完成')
      expect(summary).toContain('P7')
    }
    finally {
      dom.window.close()
    }
  })
})
