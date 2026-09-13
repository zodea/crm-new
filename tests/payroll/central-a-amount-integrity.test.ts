import { afterEach, describe, expect, it } from 'vitest'
import { payrollAMigrationReferences } from '../../server/utils/payroll-a-migration-references'
import { createPayrollAServiceFixture } from '../helpers/payroll-a-service-fixture'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
})

async function fixture() {
  const current = await createPayrollAServiceFixture()
  closers.push(current.close)
  await current.service.list({ origin: 'real' })
  return current
}

describe('a 工资公开核算的历史实付完整性', () => {
  it('旧已发实际金额缺失时保留未知，不从应发头或成员分配推定此前已付', async () => {
    const current = await fixture()
    await current.db.execute(`INSERT INTO wage_statements
      (id,project_id,crew_id,leader_worker_id,month,format_family,period_kind,quantity_source,status,pay_ratio,cumulative_amount,gross_amount,actual_amount)
      VALUES ('old-unknown','p','crew','w','2026-07','A','monthly','field','released',0.8,1000,1000,NULL)`)
    await current.db.execute(`INSERT INTO wage_statement_members(id,statement_id,worker_id,is_leader)
      VALUES ('old-leader','old-unknown','w',1)`)
    await current.db.execute(`INSERT INTO wage_statement_allocations(id,statement_id,worker_id,allocated_amount_fen)
      VALUES ('old-allocation','old-unknown','w',100000)`)

    const read = await current.form()
    expect(read.totals.previouslyPaid.value).toBeNull()
    expect(read.totals.previouslyPaid.state).toBe('unknown')
    expect(read.totals.grossAmount.value).toBeNull()
    expect(read.eligibility.canCheck).toBe(false)
    expect(read.eligibility.canRelease).toBe(false)
    expect((await current.service.detail({ origin: 'real' }, 'old-unknown')).statement.actualAmount).toBeNull()
  })

  it('累计1280扣此前实际900得到380，旧应发1000、分配与其他格式不能再扣一次', async () => {
    const current = await fixture()
    await current.db.execute(`INSERT INTO items(id,project_id,code,name,trade,unit)
      VALUES ('item','p','WALL','墙砖','泥水','㎡')`)
    await current.db.execute(`INSERT INTO payroll_a_price_revisions
      (id,price_id,project_id,crew_id,leader_worker_id,item_id,unit,mode,worker_id,effective_month,unit_price,scope_json,revision,operator_id,created_at)
      VALUES ('price-version','price','p','crew','w','item','㎡','baseline',NULL,'2026-08',200,'{"kind":"project"}',1,'actor','2026-08-01')`)
    await current.db.execute(`INSERT INTO wage_statements
      (id,project_id,crew_id,leader_worker_id,month,format_family,period_kind,quantity_source,status,pay_ratio,cumulative_amount,gross_amount,actual_amount,deleted_at)
      VALUES ('old-paid','p','crew','w','2026-07','A','monthly','field','released',0.8,1000,1000,900,'2026-08-01'),
        ('old-b','p','crew','w','2026-07','B','monthly','field','released',1,9000,9000,9000,NULL),
        ('old-c1','p','crew','w','2026-07','C1','monthly','field','released',1,9000,9000,9000,NULL),
        ('other-leader','p','crew','other','2026-07','A','monthly','field','released',1,9000,9000,9000,NULL)`)
    await current.db.execute(`INSERT INTO wage_statement_members(id,statement_id,worker_id,is_leader)
      VALUES ('old-leader','old-paid','w',1),('old-zero','old-paid','zero',0)`)
    await current.db.execute(`INSERT INTO wage_statement_allocations(id,statement_id,worker_id,allocated_amount_fen)
      VALUES ('old-allocation','old-paid','w',90000),('old-zero-allocation','old-paid','zero',0)`)

    const read = await current.form()
    expect(read.totals.workAmount.value).toBe(1600)
    expect(read.totals.cumulativeAmount.value).toBe(1280)
    expect(read.totals.previouslyPaid).toMatchObject({ value: 900, knownValue: 900, state: 'known' })
    expect(read.totals.grossAmount.value).toBe(380)
    const history = (await current.service.detail({ origin: 'real' }, 'old-paid')).statement
    expect(history).toMatchObject({ hidden: true, actualAmount: null, snapshot: { state: 'missing' } })
    expect(history.stored.head.actual_amount).toBe(900)
  })

  it('月度沿上月已保存的月度比例，未发不退回首月配置且结算比例不覆盖月度', async () => {
    const current = await fixture()
    current.source.crews[0]!.defaultPayRatio = 0.75
    current.source.crews[0]!.ratioExplicitlyConfigured = true
    await current.db.execute(`INSERT INTO wage_statements
      (id,project_id,crew_id,leader_worker_id,month,format_family,period_kind,quantity_source,status,pay_ratio,actual_amount)
      VALUES ('previous-month','p','crew','w','2026-07','A','monthly','field','checked',0.8,NULL),
        ('previous-settlement','p','crew','w','2026-07','A','settlement','field','released',0.95,100)`)

    const read = await current.form({ payRatio: undefined })
    expect(read.ratioDefault.value).toBe(0.8)
    expect(read.ratioDefault.statementId).toBe('previous-month')
    expect(read.draft.payRatio).toBe(0.8)
  })

  it('合法29分实发与零成员可以冻结，二进制小数误差不能拒绝真实整数分', async () => {
    const current = await fixture()
    await current.db.execute(`INSERT INTO items(id,project_id,code,name,trade,unit)
      VALUES ('item','p','WALL','墙砖','泥水','㎡')`)
    await current.service.execute(current.command(await current.config(), {
      kind: 'save-a-prices',
      prices: [{ priceId: null, itemId: 'item', unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: '2026-08', unitPrice: 200, scope: { kind: 'project' } }],
    }))
    const saved = await current.service.execute(current.command(await current.form(), { kind: 'save-a-draft', draft: current.draft }))
    expect(saved.statementId).toBeTruthy()
    const read = () => current.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
    await current.service.execute(current.command(await read(), { kind: 'check-a' }))
    const result = await current.service.execute(current.command(await read(), {
      kind: 'release-a',
      release: { actualAmount: 0.29, allocations: [{ workerId: 'w', amount: 0.29 }, { workerId: 'zero', amount: 0 }] },
    }))
    expect(result.outcome).toBe('released')
    const output = await current.service.aOutput({ origin: 'real' }, saved.statementId!)
    expect(output.state).toBe('available')
    expect(output.document?.actualAmount).toBe(0.29)
    expect(output.document?.allocations.map(row => [row.workerId, row.amount, row.allocatedAmountFen])).toEqual([
      ['w', 0.29, 29],
      ['zero', 0, 0],
    ])
    expect((await current.service.detail({ origin: 'real' }, saved.statementId!)).statement.actualAmount).toBe(0.29)
  })

  it.each([
    { caseName: '现场量乘单价', quantity: 1.45, unitPrice: 0.1, payRatio: 1, workAmount: 0.15 },
    { caseName: '现场金额乘比例', quantity: 1, unitPrice: 0.29, payRatio: 0.5, workAmount: 0.29 },
  ])('$caseName 的半分舍入在核算、实际发放与冻结冷读保持一致', async ({ quantity, unitPrice, payRatio, workAmount }) => {
    const current = await fixture()
    current.facts.rows[0]!.fieldQty = quantity
    current.facts.rows[0]!.fieldFormula = String(quantity)
    const draft = { ...current.draft, payRatio }
    await current.db.execute(`INSERT INTO items(id,project_id,code,name,trade,unit)
      VALUES ('item','p','WALL','墙砖','泥水','㎡')`)
    await current.service.execute(current.command(await current.config(), {
      kind: 'save-a-prices',
      prices: [{ priceId: null, itemId: 'item', unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: '2026-08', unitPrice, scope: { kind: 'project' } }],
    }))
    const preview = await current.form({ payRatio })
    expect(preview.totals.workAmount.value).toBe(workAmount)
    expect(preview.totals.grossAmount.value).toBe(0.15)
    const saved = await current.service.execute(current.command(preview, { kind: 'save-a-draft', draft }))
    const read = () => current.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
    await current.service.execute(current.command(await read(), { kind: 'check-a' }))
    const result = await current.service.execute(current.command(await read(), {
      kind: 'release-a',
      release: { actualAmount: 0.15, allocations: [{ workerId: 'w', amount: 0.15 }, { workerId: 'zero', amount: 0 }] },
    }))
    expect(result.outcome).toBe('released')
    const output = await current.service.aOutput({ origin: 'real' }, saved.statementId!)
    expect(output.state).toBe('available')
    expect(output.document).toMatchObject({ workAmount, cumulativeAmount: 0.15, grossAmount: 0.15, actualAmount: 0.15 })
    expect(output.document?.allocations.map(row => row.allocatedAmountFen)).toEqual([15, 0])
    expect((await current.service.detail({ origin: 'real' }, saved.statementId!)).statement.actualAmount).toBe(0.15)
  })

  it('日常工资保存的回执可被恢复保护识别，空配置范围不能使无关恢复一概失败', async () => {
    const current = await fixture()
    await current.db.execute(`INSERT INTO items(id,project_id,code,name,trade,unit)
      VALUES ('item','p','WALL','墙砖','泥水','㎡')`)
    await current.service.execute(current.command(await current.config(), {
      kind: 'save-a-prices',
      prices: [{ priceId: null, itemId: 'item', unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: '2026-08', unitPrice: 200, scope: { kind: 'project' } }],
    }))
    const saved = await current.service.execute(current.command(await current.form(), { kind: 'save-a-draft', draft: current.draft }))
    const references = await payrollAMigrationReferences(current.db)
    expect(references.has(JSON.stringify(['wage_statements', saved.statementId]))).toBe(true)
    expect(references.has(JSON.stringify(['workers', 'zero']))).toBe(true)
    expect(references.has(JSON.stringify(['unit_assignments', 'assignment']))).toBe(true)
    expect(references.has(JSON.stringify(['projects', 'unrelated-project']))).toBe(false)
  })
})
