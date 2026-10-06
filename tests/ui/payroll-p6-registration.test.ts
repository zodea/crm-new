import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildModuleReviewCoverage } from '../../scripts/module-review-coverage.mjs'

const productCommit = 'edc03faba20e0c5c665b7fc2011e2a4120d8428f'
const evidence = 'docs/design/evidence/issue-412-payroll-hollow/README.md'
const hollowCases = ['C-D6CAD39409A2', 'C-1785D3BD0ACB', 'C-646DC1829859']
describe('p6 limited delivery registration', () => {
  it('preserves the fixed P6 evidence after the later P7 registration', () => {
    const coverage = buildModuleReviewCoverage()
    const byId = (id: string) => coverage.obligations.find(item => item.id === id)!
    expect(byId('WAGE-15')).toMatchObject({ status: 'current-passed' })
    expect(byId('WAGE-15').evidence).toContainEqual(expect.objectContaining({ reference: evidence, commit: productCommit, recency: 'current-run' }))
    expect(byId('WAGE-15').remaining).toContain('逐单人工')
    expect(byId('WAGE-18')).toMatchObject({ status: 'partial' })
    expect(byId('WAGE-18').evidence).toContainEqual(expect.objectContaining({ reference: evidence, commit: productCommit }))
    expect(byId('WAGE-18').remaining).toContain('#479')
    for (const id of ['WAGE-16', 'WAGE-17']) {
      expect(byId(id).status).toBe('current-passed')
      expect(byId(id).evidence).toContainEqual(expect.objectContaining({ reference: 'docs/design/evidence/issue-412-payroll-batch-workbooks/README.md' }))
    }
    expect(new Set(byId('WAGE-15').caseIds).size).toBe(byId('WAGE-15').caseIds.length)
    for (const caseId of hollowCases) {
      const current = coverage.cases.find(item => item.id === caseId)!
      expect(current).toMatchObject({ host: 'browser', adapter: 'central-http', acceptance: { rules: 'scoped-defined', frontend: 'passed', crossModule: 'passed', production: 'not-verified' } })
      expect(current.reviewEvidence).toContain(evidence)
      expect(current.obligationIds).toContain('WAGE-15')
    }
    expect(coverage.counts).toMatchObject({
      productionRoutes: new Set(coverage.surfaces.map(surface => surface.route)).size,
      rootVariants: coverage.surfaces.filter(surface => surface.path === 'page').length,
      surfaces: coverage.surfaces.length,
      environmentCases: coverage.cases.length,
    })
  })

  it('preserves the confirmed manual deduction and frozen-history rules without reviving the old questionnaire', () => {
    const page = readFileSync('docs/rewrite/pages/subcontract-payroll.md', 'utf8')
    const commands = readFileSync('docs/rewrite/COMMANDS.md', 'utf8')
    const reads = readFileSync('docs/rewrite/READ-MODELS.md', 'utf8')

    expect(page).toContain('每单由经办人确认新增未处理项，启动不跨单继承')
    expect(page).toContain('原15处已扣、尚余5处未修、本月另有独立新增2处时，只在本单人工启动新增2处')
    expect(page).toContain('已采用记录后来修订总数需要核实更正，不能猜成新增检查')
    expect(commands).toContain('完整正扣款恰抵可领额可明确实发 0')
    expect(commands).toContain('已处理源不因后月/整改/退款/改名再开放')
    expect(reads).toContain('“暂无检查”与“明确检查零处”分别表达')
    expect(reads).toContain('当前读取失败时保留冻结区并明确失败')
    expect(reads).toContain('不以当前行重算原工资')

    const hollowObligation = buildModuleReviewCoverage().obligations.find(item => item.id === 'WAGE-15')!
    expect(hollowObligation.remaining).toContain('新增2处')
    expect(hollowObligation.remaining).toContain('#467')
    for (const path of [evidence, 'docs/guides/payroll-hollow.md'])
      expect(existsSync(resolve(path))).toBe(true)
  })
})
