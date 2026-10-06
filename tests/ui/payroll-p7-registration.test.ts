import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildModuleReviewCoverage } from '../../scripts/module-review-coverage.mjs'

const productCommit = 'a2f117f52dffe3d7867f4ff82a1d62be372b0c2b'
const evidence = 'docs/design/evidence/issue-412-payroll-batch-workbooks/README.md'
describe('p7 limited delivery registration', () => {
  it('binds batch and workbook obligations to the fixed product while leaving roster and production open', () => {
    const coverage = buildModuleReviewCoverage()
    const byId = (id: string) => coverage.obligations.find(item => item.id === id)!
    for (const id of ['WAGE-16', 'WAGE-17']) {
      expect(byId(id).status).toBe('current-passed')
      expect(byId(id).evidence).toContainEqual(expect.objectContaining({ reference: evidence, commit: productCommit, recency: 'current-run' }))
      expect(byId(id).remaining).toContain('#467')
    }
    expect(byId('WAGE-18').status).toBe('partial')
    expect(byId('WAGE-18').evidence).toContainEqual(expect.objectContaining({ reference: evidence, commit: productCommit }))
    expect(byId('WAGE-16').remaining).toContain('PR483')
    expect(byId('WAGE-17').remaining).toContain('#477')
    expect(byId('WAGE-18').remaining).toContain('独立私密权限')
    expect(byId('WAGE-18').remaining).toContain('#479')
    expect(byId('WAGE-12').status).toBe('partial')
    expect(byId('WAGE-12').evidence).toContainEqual(expect.objectContaining({ reference: evidence, commit: productCommit }))
    expect(byId('WAGE-12').remaining).toContain('#467')
  })

  it('protects the confirmed batch, reconciliation and private archive rules in the current authorities', () => {
    const page = readFileSync('docs/rewrite/pages/subcontract-payroll.md', 'utf8')
    const commands = readFileSync('docs/rewrite/COMMANDS.md', 'utf8')
    const reads = readFileSync('docs/rewrite/READ-MODELS.md', 'utf8')
    const database = readFileSync('docs/rewrite/DATABASE.md', 'utf8')

    expect(page).toContain('333.34/333.33/333.33')
    expect(page).toContain('整单600、普通400、资金700时建议600/100')
    expect(page).toContain('同余按稳定簿身份、原工资 ID 决定')
    expect(page).toContain('未知结果只能按同一原键恢复')
    expect(commands).toContain('只创建不可变计划')
    expect(commands).toContain('先保存完整原格式命令，暂缓项不准备')
    expect(commands).toContain('归档不发工资、取号或记收付')
    expect(page).toContain('A 周期公式应付采用最新合法累计口径，不把逐月累计重复相加')
    expect(page).toContain('公式应付为本月各张原单本次核算合计')
    expect(reads).toContain('worker:sensitive:read')
    expect(reads).toContain('工资权限可阅读及下载工资部分，完整实名附件需重新单独授权')
    expect(database).toContain('之后真实补退只进入新目录版本')
    expect(database).toContain('生产落盘由 #467 承接')
    for (const path of [evidence, 'docs/guides/payroll-complete-workbook.md'])
      expect(existsSync(resolve(path))).toBe(true)
  })
})
