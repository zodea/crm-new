import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { buildModuleReviewCoverage } from '../../scripts/module-review-coverage.mjs'

const productCommit = '61a6a10ddee611125d9d10b8dfd9dd81f99db467'
const evidence = 'docs/design/evidence/issue-412-payroll-fees/README.md'
const payrollACases = ['C-9C98D806E9B1', 'C-D8B07FE3B973', 'C-D3A1780D1250', 'C-D5D665364A7D', 'C-A7B5F1FDD485', 'C-7E706511E4DD', 'C-2E84963015A0', 'C-7DC8B7374ADB', 'C-C9CB7033103F', 'C-322BD11C58B3', 'C-F8C579338CD4']
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
  graph: { width: number, height: number, nodes: ReportNode[], edges: unknown[] }
}

describe('p5 limited delivery registration', () => {
  it('binds the product evidence to existing A cases without upgrading page or production acceptance', () => {
    const coverage = buildModuleReviewCoverage()
    const byId = (id: string) => coverage.obligations.find(item => item.id === id)!
    for (const id of ['WAGE-09', 'WAGE-10', 'WAGE-11', 'WAGE-12', 'WAGE-14']) {
      expect(byId(id).evidence).toContainEqual(expect.objectContaining({ reference: evidence, commit: productCommit, recency: 'current-run' }))
      expect(new Set(byId(id).caseIds).size).toBe(byId(id).caseIds.length)
    }
    expect(byId('WAGE-09').status).toBe('partial')
    expect(byId('WAGE-12').status).toBe('partial')
    for (const id of ['WAGE-10', 'WAGE-11', 'WAGE-14'])
      expect(byId(id).status).toBe('current-passed')
    expect(new Set(byId('WAGE-14').caseIds)).toEqual(new Set([...payrollACases, 'C-5751CF6E9985', 'C-7C09C38C854D']))
    expect(byId('WAGE-14').caseIds).toHaveLength(13)
    expect(byId('WAGE-14').remaining).toContain('本地 grill')
    expect(byId('WAGE-09').remaining).toContain('材料/报销')
    expect(byId('WAGE-10').remaining).toContain('公开服务/组件')
    expect(byId('WAGE-11').remaining).toContain('原JSON')
    expect(byId('WAGE-12').remaining).toContain('P6/P7')
    for (const id of ['WAGE-15', 'WAGE-16', 'WAGE-17']) {
      expect(byId(id).status).toBe('ready')
      expect(byId(id).evidence).toEqual([])
    }
    for (const caseId of payrollACases) {
      const linked = coverage.cases.find(item => item.id === caseId)!
      expect(linked.host).toBe('browser')
      expect(linked.obligationIds).toContain('WAGE-14')
      expect(linked.acceptance).toEqual({ rules: 'needs-review', frontend: 'not-verified', crossModule: 'not-verified', production: 'not-verified' })
    }
    expect(coverage.counts).toMatchObject({ rootVariants: 208, surfaces: 754, environmentCases: 1221 })
  })

  it('keeps the report partial, preserves the remaining decisions and renders the actual P5 evidence consistently', () => {
    const rows: ReportRow[] = JSON.parse(readFileSync(`${reportDirectory}/rows-business.json`, 'utf8'))
    const row = rows.find(item => item.number === 412)!
    const dom = new JSDOM(readFileSync(`${reportDirectory}/index.html`, 'utf8'))
    try {
      const document = dom.window.document
      const embedded: ReportRow[] = JSON.parse(document.querySelector('#review-data')!.textContent!)
      const rendered = embedded.find(item => item.number === 412)!
      expect(embedded).toHaveLength(46)
      expect(embedded.filter(item => item.status === 'local-done')).toHaveLength(31)
      expect(embedded.filter(item => item.status === 'partial')).toHaveLength(14)
      expect(embedded.filter(item => item.status === 'decision')).toHaveLength(1)
      expect(row.status).toBe('partial')
      for (const field of ['status', 'solved', 'remaining', 'evidence', 'questions', 'graph'] as const)
        expect(rendered[field]).toEqual(row[field])
      expect(row.solved.join('\n')).toContain(productCommit)
      expect(row.solved.join('\n')).toContain('740文件4190项')
      expect(row.solved.join('\n')).toContain('74f831f7da0dc37f7ec031279223649a6f32fbee')
      expect(row.remaining.join('\n')).toContain('P6/P7')
      expect(row.questions).toHaveLength(7)
      expect(row.questions[0]).toContain('每人或每月')
      expect(row.questions[1]).toContain('默认规则')
      expect(row.questions[2]).toContain('另一主体或项目')
      expect(row.evidence).toEqual(expect.arrayContaining([evidence, 'docs/guides/payroll-fees.md', 'docs/design/evidence/issue-412-payroll-fees/browser/supplement-390/negative-readable-amount-columns-390.png']))
      for (const path of row.evidence.filter(item => item.includes('payroll-fees')))
        expect(existsSync(resolve(path))).toBe(true)
      expect(row.graph.nodes).toHaveLength(18)
      expect(row.graph.edges).toHaveLength(27)
      expect(row.graph.nodes.find(item => item.id === 'frozen')!.lines).toContain('A普通/管理分簿，软删不解锁')
      expect(row.graph.nodes.find(item => item.id === 'end')!.lines).toContain('空鼓、批量资金及完整工作簿继续实施')
      const article = document.querySelector('#issue-412')!
      expect(article.querySelectorAll('[data-graph-node]')).toHaveLength(18)
      expect(article.querySelectorAll('[data-graph-edge]')).toHaveLength(27)
      expect([...article.querySelectorAll('.flow-scroll svg text')].map(item => item.textContent)).toEqual(row.graph.nodes.flatMap(item => [item.title, ...item.lines]))
      const readme = readFileSync(`${reportDirectory}/README.md`, 'utf8')
      const summaryRow = readme.split(/\r?\n/).find(line => line.startsWith('| [#412 '))!
      expect(summaryRow).toContain(productCommit)
      expect(summaryRow).toContain('部分完成')
      expect(summaryRow).toContain('P6/P7')
    }
    finally {
      dom.window.close()
    }
  })
})
