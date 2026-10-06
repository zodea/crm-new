import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildModuleReviewCoverage } from '../../scripts/module-review-coverage.mjs'

const productCommit = '61a6a10ddee611125d9d10b8dfd9dd81f99db467'
const evidence = 'docs/design/evidence/issue-412-payroll-fees/README.md'
const payrollACases = ['C-9C98D806E9B1', 'C-D8B07FE3B973', 'C-D3A1780D1250', 'C-D5D665364A7D', 'C-A7B5F1FDD485', 'C-7E706511E4DD', 'C-2E84963015A0', 'C-7DC8B7374ADB', 'C-C9CB7033103F', 'C-322BD11C58B3', 'C-F8C579338CD4']
// 仅验证权威规则与限定证据登记；通过不代表工资计算、发放或生产持久化已验收。
describe('p5 文档与生成物一致性（非工资业务验收）', () => {
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
    expect(byId('WAGE-14').caseIds).toHaveLength(payrollACases.length + 2)
    for (const issue of ['#472', '#473', '#474', '#475'])
      expect(byId('WAGE-14').remaining).toContain(issue)
    expect(byId('WAGE-09').remaining).toContain('材料/报销')
    expect(byId('WAGE-10').remaining).toContain('公开服务回归')
    expect(byId('WAGE-11').remaining).toContain('保持冻结')
    expect(byId('WAGE-12').remaining).toContain('P7')
    // 条件：P6 空鼓已独立登记；动作：读取 P5 登记；结果：不能误绑 P5 费用证据。
    // 防止报告把费用交付当成空鼓扣款验收，业务正确性由工资服务测试验证。
    expect(byId('WAGE-15').evidence).not.toContainEqual(expect.objectContaining({ reference: evidence }))
    for (const id of ['WAGE-16', 'WAGE-17']) {
      expect(byId(id).status).toBe('current-passed')
      expect(byId(id).evidence).toContainEqual(expect.objectContaining({ reference: 'docs/design/evidence/issue-412-payroll-batch-workbooks/README.md' }))
    }
    for (const caseId of payrollACases) {
      const linked = coverage.cases.find(item => item.id === caseId)!
      expect(linked.host).toBe('browser')
      expect(linked.obligationIds).toContain('WAGE-14')
      expect(linked.acceptance).toEqual({ rules: 'needs-review', frontend: 'not-verified', crossModule: 'not-verified', production: 'not-verified' })
    }
    // 后续交付可增补路由；P5 已登记身份和限定证据仍必须全部存在。
    expect(coverage.counts.rootVariants).toBe(coverage.surfaces.filter(surface => surface.path === 'page').length)
    expect(coverage.counts.surfaces).toBe(coverage.surfaces.length)
    expect(coverage.counts.environmentCases).toBe(coverage.cases.length)
  })

  it('keeps the current fee rules and unresolved policy boundaries in their authoritative documents', () => {
    const page = readFileSync('docs/rewrite/pages/subcontract-payroll.md', 'utf8')
    const commands = readFileSync('docs/rewrite/COMMANDS.md', 'utf8')
    const reads = readFileSync('docs/rewrite/READ-MODELS.md', 'utf8')
    const database = readFileSync('docs/rewrite/DATABASE.md', 'utf8')

    expect(page).toContain('/subcontract/payroll/config')
    expect(page).toContain('管理费 1500 − 600 后按 80%，再扣本簿已领 200，本次 520')
    expect(commands).toContain('房补默认采用保留语义确认及经办依据')
    expect(commands).toContain('普通/管理簿独立，不合并补退')
    expect(reads).toContain('来源缺损仍提供诊断及可证部分，不伪装为无费用或已领 0')
    expect(database).toContain('退款不重开原领取')
    expect(page).toContain('额外费用取舍仍由 #472–#475 承接')

    const feeObligation = buildModuleReviewCoverage().obligations.find(item => item.id === 'WAGE-14')!
    for (const issue of ['#472', '#473', '#474', '#475'])
      expect(feeObligation.remaining).toContain(issue)
    for (const path of [evidence, 'docs/guides/payroll-fees.md'])
      expect(existsSync(resolve(path))).toBe(true)
  })
})
