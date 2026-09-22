import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { buildModuleReviewCoverage } from '../../scripts/module-review-coverage.mjs'

const productCommit = 'a2f117f52dffe3d7867f4ff82a1d62be372b0c2b'
const evidence = 'docs/design/evidence/issue-412-payroll-batch-workbooks/README.md'
const reportDirectory = 'docs/research/issue-review-2026-09-11'

interface ReportRow {
  number: number
  status: string
  solved: string[]
  remaining: string[]
  evidence: string[]
  questions: string[]
  screens: Array<{ title: string }>
}

describe('p7 limited delivery registration', () => {
  it('binds batch and workbook obligations to the fixed product while leaving roster and production open', () => {
    const coverage = buildModuleReviewCoverage()
    const byId = (id: string) => coverage.obligations.find(item => item.id === id)!
    for (const id of ['WAGE-16', 'WAGE-17']) {
      expect(byId(id).status).toBe('current-passed')
      expect(byId(id).evidence).toContainEqual(expect.objectContaining({ reference: evidence, commit: productCommit, recency: 'current-run' }))
      expect(byId(id).remaining).toContain('grill')
    }
    expect(byId('WAGE-18').status).toBe('partial')
    expect(byId('WAGE-18').evidence).toContainEqual(expect.objectContaining({ reference: evidence, commit: productCommit }))
    expect(byId('WAGE-18').remaining).toContain('最小授权')
    expect(byId('WAGE-12').status).toBe('partial')
    expect(byId('WAGE-12').evidence).toContainEqual(expect.objectContaining({ reference: evidence, commit: productCommit }))
    expect(byId('WAGE-12').remaining).toContain('#416')
  })

  it('keeps #412 partial and records P7 results without dropping the seven business questions', () => {
    const rows: ReportRow[] = JSON.parse(readFileSync(`${reportDirectory}/rows-business.json`, 'utf8'))
    const row = rows.find(item => item.number === 412)!
    const dom = new JSDOM(readFileSync(`${reportDirectory}/index.html`, 'utf8'))
    try {
      const embedded: ReportRow[] = JSON.parse(dom.window.document.querySelector('#review-data')!.textContent!)
      expect(embedded.find(item => item.number === 412)).toEqual(expect.objectContaining(row))
      expect(row.status).toBe('partial')
      expect(row.solved.join('\n')).toContain(productCommit)
      expect(row.solved.join('\n')).toContain('793文件4339项')
      expect(row.remaining.join('\n')).toContain('P7自动尾差')
      expect(row.remaining.join('\n')).toContain('#416')
      expect(row.questions).toHaveLength(7)
      expect(row.questions[4]).toContain('P7 资金建议')
      expect(row.questions[5]).toContain('P7 工资编号')
      expect(row.questions[6]).toContain('P7 完整名册')
      expect(row.screens.some(item => item.title.startsWith('P7批次资金'))).toBe(true)
      expect(row.screens.some(item => item.title.startsWith('P7完整工作簿'))).toBe(true)
      expect(row.evidence).toContain(evidence)
      for (const path of row.evidence.filter(item => item.includes('payroll-batch-workbooks')))
        expect(existsSync(resolve(path))).toBe(true)
      const summary = readFileSync(`${reportDirectory}/README.md`, 'utf8').split(/\r?\n/).find(line => line.startsWith('| [#412 '))!
      expect(summary).toContain(productCommit)
      expect(summary).toContain('部分完成')
      expect(summary).toContain('P7自动尾差')
    }
    finally {
      dom.window.close()
    }
  })
})
