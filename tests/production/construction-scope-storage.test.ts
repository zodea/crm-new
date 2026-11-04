import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CommandRecoveryDescriptor } from '../../app/lib/forms/command-recovery'
import process from 'node:process'
import { afterAll, expect, it } from 'vitest'
import { constructionScopeSourceKey } from '../../app/lib/construction-scope/contract'
import { createConstructionScopeRepository } from '../../app/lib/construction-scope/repository'
import { createFinanceCommandActions } from '../../app/lib/finance/command-session'
import { createFinanceRepository } from '../../app/lib/finance/http-repository'
import { createProductionAuxiliaryContractService } from '../../server/utils/production-auxiliary-contract-service'
import { appendProductionConstructionScopeBinding } from '../../server/utils/production-construction-scope-command'
import { readProductionConstructionScopeMainFact, validateProductionConstructionScopeState } from '../../server/utils/production-construction-scope-record'
import { createProductionConstructionScopeService } from '../../server/utils/production-construction-scope-service'
import { readProductionConstructionSpending } from '../../server/utils/production-construction-scope-spending'
import { listOriginalExpenseReferences } from '../../server/utils/production-finance-expense-references'
import { validateFinanceJournal } from '../../server/utils/production-finance-journal'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { createProductionOtherSettlementService, readProductionOtherSettlementReference } from '../../server/utils/production-other-settlement-service'
import { createProductionPayrollService } from '../../server/utils/production-payroll-service'
import { createProductionSubcontractContractService } from '../../server/utils/production-subcontract-contract-service'
import { runColdProcess } from '../helpers/cold-process'
import { constructionScopeCommand, createConstructionScopeFixture } from '../helpers/production-construction-scope-fixture'
import { cleanupTestTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

it('真实新材采草稿原子关联Main由独立历史读投影显示，HTTP互证身份，撤Main读权不泄名称且不计承诺', async () => {
  const f = await createConstructionScopeFixture()
  try {
    const context = await f.materialService.context(f.session)
    const selection = context.constructionMains!.find(row => row.id === f.secondMain.id)!
    const form = await f.materialService.form(f.material.id, f.session)
    const { id: _id, ...original } = form.draft
    const saved = await f.materialService.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'material-contract:write', commandId: 'draft-existing-main-read', baseVersion: null, action: 'draft', draft: { ...original, name: '只读草稿归属', no: 'DRAFT-READONLY-MAIN', status: '草稿' }, constructionMain: { id: selection.id, projectId: selection.projectId, basis: selection.basis }, attachments: {} }, f.session)
    const source = { domain: 'material-contract' as const, id: saved.id }
    const read = await f.scope.read(source, f.session)
    expect(read).toMatchObject({ eligible: false, candidates: [], candidateState: 'unavailable', relation: { mainId: f.secondMain.id }, existingMain: { entity: 'contract', state: 'resolved', id: f.secondMain.id, label: '施工主合同乙', no: 'MAIN-SCOPE-B' } })
    const repository = createConstructionScopeRepository(async () => read)
    expect(await repository.read(source)).toEqual(read)
    await expect(createConstructionScopeRepository(async () => ({ ...read, existingMain: { ...read.existingMain, id: f.main.id } })).read(source)).rejects.toThrow('可信身份')
    const deniedActor = { ...f.actor, capabilities: f.actor.capabilities.filter(capability => capability !== 'construction-contract:read') }
    const denied = await f.scope.read(source, () => deniedActor)
    expect(denied.existingMain).toEqual({ entity: 'contract', state: 'forbidden', id: null, label: null, reason: 'permission-denied' })
    expect(denied.candidates).toEqual([])
    expect(JSON.stringify(denied)).not.toContain('施工主合同乙')
    expect(await createConstructionScopeRepository(async () => denied).read(source)).toEqual(denied)
    await expect(createConstructionScopeRepository(async () => ({ ...denied, existingMain: { ...denied.existingMain, label: '不应泄露合同名' } })).read(source)).rejects.toThrow('可信身份')
    const spending = await f.storage.withTransaction(tx => readProductionConstructionSpending(tx, f.actor, f.project.id, f.secondMain.id))
    expect(spending.rows.some(row => row.sourceId === saved.id)).toBe(false)
    expect(await f.storage.select('SELECT id FROM payment_records')).toEqual([])
    await f.storage.withTransaction(validateProductionConstructionScopeState)
  }
  finally { await f.storage.close() }
})

it('正式材料及原费用仅关联单个同项目主合同，回执重复、解绑历史及原经济事实完整保留', async () => {
  const f = await createConstructionScopeFixture()
  try {
    const source = { domain: 'material-contract' as const, id: f.material.id }
    const read = await f.scope.read(source, f.session)
    const initialVersion = Number(read.relation?.version ?? '0')
    const initialHistory = await f.storage.select('SELECT main_id FROM construction_scope_history WHERE source_id=? ORDER BY version', [source.id])
    expect(read.candidates.map(row => row.id)).toEqual(expect.arrayContaining([f.main.id, f.secondMain.id]))
    const before = await f.storage.select('SELECT record_json FROM material_contract_records WHERE id=?', [f.material.id])
    const original = constructionScopeCommand(read, 'scope-bind-original', f.main.id)
    const saved = await f.scope.execute(original, f.session)
    expect(await f.scope.execute(original, f.session)).toEqual(saved)
    expect(await f.storage.select('SELECT record_json FROM material_contract_records WHERE id=?', [f.material.id])).toEqual(before)
    await expect(f.scope.execute({ ...original, commandId: 'scope-stale-second', mainId: f.secondMain.id, mainBasis: read.candidates.find(row => row.id === f.secondMain.id)!.basis }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const updated = await f.scope.read(source, f.session)
    await f.scope.execute(constructionScopeCommand(updated, 'scope-unbind', null), f.session)
    expect((await f.scope.read(source, f.session)).relation).toMatchObject({ mainId: null, version: String(initialVersion + 2) })
    expect(await f.storage.select('SELECT main_id FROM construction_scope_history WHERE source_id=? ORDER BY version', [source.id])).toEqual([...initialHistory, { main_id: f.main.id }, { main_id: null }])
    const expenseSource = { domain: 'original-expense' as const, id: f.expenseId }
    const expenseBefore = await f.storage.select('SELECT * FROM expense_reimbursement_lines ORDER BY id')
    const expenseSaved = await f.scope.execute(constructionScopeCommand(await f.scope.read(expenseSource, f.session), 'scope-bind-expense', f.main.id), f.session)
    expect(expenseSaved.relation).toMatchObject({ sourceId: f.expenseId, mainId: f.main.id })
    expect(await f.storage.select('SELECT * FROM expense_reimbursement_lines ORDER BY id')).toEqual(expenseBefore)
    await f.storage.withTransaction(validateProductionConstructionScopeState)
    await expect(f.storage.execute('DELETE FROM construction_scope_history')).rejects.toThrow('immutable')
  }
  finally { await f.storage.close() }
})

it('组合来源append只用调用方原事务：关系回执故障整批源行回滚，新草稿归属不造费用/现金', async () => {
  const f = await createConstructionScopeFixture()
  try {
    const main = (await f.scope.read({ domain: 'original-expense', id: f.expenseId }, f.session)).candidates.find(row => row.id === f.main.id)!
    const source = { domain: 'original-expense' as const, id: 'atomic-original-expense-line' }
    const original = { family: 'finance-reimbursement' as const, commandId: 'atomic-source-original-command' }
    const write = async (tx: TransactionDb, failReceipt: boolean) => {
      await tx.execute(`INSERT INTO expense_reimbursements(id,project_id,status,created_at,updated_at) VALUES(?,?, 'draft','2026-10-07T00:00:00Z','2026-10-07T00:00:00Z')`, ['atomic-original-expense-head', f.project.id])
      await tx.execute(`INSERT INTO expense_reimbursement_lines(id,reimbursement_id,expense_item,amount,created_at,updated_at) VALUES(?,?,?,25,'2026-10-07T00:00:00Z','2026-10-07T00:00:00Z')`, [source.id, 'atomic-original-expense-head', '尚未确认的实际业务草稿'])
      return appendProductionConstructionScopeBinding({ ...tx, execute: async (sql, params) => {
        if (failReceipt && sql.startsWith('INSERT INTO construction_scope_receipts'))
          throw new Error('atomic child receipt failure')
        return tx.execute(sql, params)
      } }, f.actor, { source, main: { id: main.id, projectId: main.projectId, basis: main.basis }, original })
    }
    await expect(f.storage.withTransaction(tx => write(tx, true))).rejects.toThrow('atomic child receipt failure')
    expect(await f.storage.select('SELECT id FROM expense_reimbursements WHERE id=?', ['atomic-original-expense-head'])).toEqual([])
    expect(await f.storage.select('SELECT * FROM construction_scope_history WHERE source_id=?', [source.id])).toEqual([])
    const saved = await f.storage.withTransaction(tx => write(tx, false))
    expect(saved.relation).toMatchObject({ sourceId: source.id, mainId: f.main.id, version: '1' })
    await expect(f.storage.withTransaction(validateProductionConstructionScopeState)).rejects.toMatchObject({ problem: { code: 'unavailable', message: expect.stringContaining('原来源提交') } })
    const request = JSON.parse((await f.storage.select<{ request_json: string }>('SELECT request_json FROM construction_scope_intents WHERE command_id=?', [saved.commandId]))[0]!.request_json)
    expect(request.originalSourceCommand).toEqual(original)
    await expect(f.scope.execute(request, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect((await f.storage.select('SELECT SUM(amount) AS amount FROM expense_reimbursement_lines line JOIN expense_reimbursements head ON head.id=line.reimbursement_id WHERE head.status=\'confirmed\' AND line.original_expense_line_id IS NULL'))[0]).toEqual({ amount: 100 })
    expect(await f.storage.select('SELECT * FROM payment_records')).toEqual([])
  }
  finally { await f.storage.close() }
})

it('新F3原明细与每行真实Main由同一个原finance命令原子保存，缺工程拒且原回执/后读/cold互证', async () => {
  const f = await createConstructionScopeFixture()
  try {
    const mainA = await f.storage.withTransaction(tx => readProductionConstructionScopeMainFact(tx, f.actor, f.main.id))
    const mainB = await f.storage.withTransaction(tx => readProductionConstructionScopeMainFact(tx, f.actor, f.secondMain.id))
    const selection = (main: typeof mainA) => ({ id: main.id, projectId: main.projectId!, basis: main.basis })
    const base = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, kind: 'reimbursement' as const, requiredCapability: 'finance-reimbursement:write', baseVersion: null, action: 'save' as const, attachments: {}, draft: { projectId: f.project.id, applicantSupplierId: f.supplier.id, reimbursementDate: '2026-10-07', status: 'confirmed', lines: [{ expenseItem: '施工甲的实际业务费用', counterpartySupplierId: f.supplier.id, amount: 25 }, { expenseItem: '施工乙的实际业务费用', counterpartySupplierId: f.supplier.id, amount: 35 }] } }
    const before = await f.storage.select('SELECT id FROM expense_reimbursements ORDER BY id')
    await expect(f.finance.execute({ ...base, commandId: 'new-expense-missing-engineering' }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(await f.storage.select('SELECT id FROM expense_reimbursements ORDER BY id')).toEqual(before)
    const command = { ...base, action: 'submit' as const, commandId: 'new-expense-atomic-engineering', draft: { ...base.draft, lines: [{ ...base.draft.lines[0]!, constructionMain: selection(mainA) }, { ...base.draft.lines[1]!, constructionMain: selection(mainB) }] } }
    const result = await f.finance.execute(command, f.session)
    expect(result.constructionScopeLinks?.map(row => row.relation.mainId)).toEqual([f.main.id, f.secondMain.id])
    expect(await f.finance.execute(command, f.session)).toEqual(result)
    const form = await f.finance.form('reimbursement', result.id, f.session)
    expect(form.draft.status).toBe('submitted')
    expect(result.expenseLineIdentities).toEqual(form.draft.lines.map((line, inputIndex) => ({ inputIndex, id: line.id })))
    expect(Object.fromEntries(form.draft.lines.map(row => [row.amount, row.constructionMain?.id]))).toEqual({ 25: f.main.id, 35: f.secondMain.id })
    await f.storage.close()
    expect(await f.finance.resolve('reimbursement', command.commandId, f.session)).toEqual({ outcome: 'applied', result })
    expect((await f.finance.form('reimbursement', result.id, f.session)).draft.lines.every(row => row.constructionScopeVersion === '1')).toBe(true)
    const child = await runColdProcess('production-construction-scope-cold', [], { env: { ...process.env, CRM_CONSTRUCTION_SCOPE_COLD: JSON.stringify({ options: f.options, actor: f.actor, descriptors: [], finance: [{ commandId: command.commandId, id: result.id }] }) } })
    const cold = JSON.parse(child.stdout).finance[0]
    expect(cold.resolved).toEqual({ outcome: 'applied', result })
    expect(cold.form.draft).toEqual(form.draft)
    expect(cold.form.version).toBe(form.version)
    expect(cold.form.attachments).toEqual(form.attachments)
    await f.storage.withTransaction(validateProductionConstructionScopeState)
    const parentRow = (await f.storage.select<{ result_json: string }>('SELECT result_json FROM finance_commands WHERE command_id=?', [command.commandId]))[0]!
    const altered = JSON.parse(parentRow.result_json)
    altered.expenseLineIdentities.reverse()
    await f.storage.execute('UPDATE finance_commands SET result_json=? WHERE command_id=?', [JSON.stringify(altered), command.commandId])
    await expect(f.storage.withTransaction(tx => validateFinanceJournal(tx, f.actor))).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    altered.expenseLineIdentities.reverse()
    altered.constructionScopeLinks[0].relation.mainId = f.secondMain.id
    await f.storage.execute('UPDATE finance_commands SET result_json=? WHERE command_id=?', [JSON.stringify(altered), command.commandId])
    await expect(f.storage.withTransaction(tx => validateFinanceJournal(tx, f.actor))).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await expect(f.storage.withTransaction(validateProductionConstructionScopeState)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await f.storage.execute('UPDATE finance_commands SET result_json=? WHERE command_id=?', [parentRow.result_json, command.commandId])
    await f.storage.withTransaction(tx => validateFinanceJournal(tx, f.actor))
    await f.storage.withTransaction(validateProductionConstructionScopeState)
    let wrongRead = true
    let executes = 0
    let resolves = 0
    const repository = createFinanceRepository(async (path, options) => {
      if (path.endsWith('/context'))
        return f.finance.context('reimbursement', f.session)
      if (path === '/api/commands/finance') {
        executes++
        return f.finance.execute(options?.body, f.session)
      }
      if (path === '/api/commands/finance/resolve') {
        resolves++
        return f.finance.resolve('reimbursement', String(Reflect.get(options?.body ?? {}, 'commandId')), f.session)
      }
      if (path.includes('/form/')) {
        const read = await f.finance.form('reimbursement', path.slice(path.lastIndexOf('/') + 1), f.session)
        if (wrongRead)
          read.draft.lines[0]!.constructionMain = selection(mainB)
        return read
      }
      throw new Error('未登记的真实费用测试接口')
    })
    const markers = new Map<string, string>()
    const browser = createFinanceCommandActions('reimbursement', () => repository, () => ({ getItem: key => markers.get(key) ?? null, setItem: (key, value) => markers.set(key, value), removeItem: key => markers.delete(key) }))
    const browserSession = browser.createSession()
    await browser.hydrate(browserSession, null)
    await expect(browser.saveForm(browserSession, command.draft, 'submit')).rejects.toThrow('已保存待刷新')
    expect(browserSession.pending?.result).not.toBeNull()
    expect(markers.size).toBe(1)
    expect(executes).toBe(1)
    wrongRead = false
    const recovered = await browser.recover(browserSession)
    expect(recovered.outcome).toBe('applied')
    expect(executes).toBe(1)
    expect(resolves).toBe(0)
    expect(markers.size).toBe(0)
    const faultCommand = { ...command, commandId: 'new-expense-atomic-receipt-fault' }
    const faults = createProductionFinanceService({ ...f.storage, withTransaction: async <T>(work: (tx: TransactionDb) => Promise<T>) => f.storage.withTransaction(tx => work({ ...tx, execute: async (sql, params) => {
      if (sql.startsWith('INSERT INTO construction_scope_receipts'))
        throw new Error('source scope receipt fault')
      return tx.execute(sql, params)
    } })) })
    const snapshots = await f.storage.select('SELECT * FROM expense_reimbursement_lines ORDER BY id')
    await expect(faults.execute(faultCommand, f.session)).rejects.toThrow('source scope receipt fault')
    expect(await f.storage.select('SELECT * FROM expense_reimbursement_lines ORDER BY id')).toEqual(snapshots)
    expect(await f.finance.resolve('reimbursement', faultCommand.commandId, f.session)).toEqual({ outcome: 'not-applied', commandId: faultCommand.commandId })
  }
  finally { await f.storage.close() }
})

it('新草稿仍必选工程，原零行过滤后每个正额只绑定自己输入位置的真实Main，不造成本或现金', async () => {
  const f = await createConstructionScopeFixture()
  try {
    const mainA = await f.storage.withTransaction(tx => readProductionConstructionScopeMainFact(tx, f.actor, f.main.id))
    const mainB = await f.storage.withTransaction(tx => readProductionConstructionScopeMainFact(tx, f.actor, f.secondMain.id))
    const choice = (main: typeof mainA) => ({ id: main.id, projectId: main.projectId!, basis: main.basis })
    const beforeCost = await f.storage.withTransaction(tx => readProductionConstructionSpending(tx, f.actor, f.project.id))
    const request = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'new-draft-zero-filter-main', kind: 'reimbursement' as const, requiredCapability: 'finance-reimbursement:write', baseVersion: null, action: 'draft' as const, attachments: {}, draft: { projectId: f.project.id, constructionMain: choice(mainA), lines: [{ amount: 0, expenseItem: '尚未发生零占位' }, { amount: 35, expenseItem: '草稿乙费用', constructionMain: choice(mainB) }, { amount: 25, expenseItem: '草稿甲费用', constructionMain: choice(mainA) }] } }
    const { constructionMain: _missingMain, ...missingMain } = request.draft
    await expect(f.finance.execute({ ...request, commandId: 'new-draft-missing-main', draft: missingMain }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    const result = await f.finance.execute(request, f.session)
    const form = await f.finance.form('reimbursement', result.id, f.session)
    expect(form.draft.lines.map(line => [line.expenseItem, line.amount, line.constructionMain?.id])).toEqual([['草稿乙费用', 35, f.secondMain.id], ['草稿甲费用', 25, f.main.id]])
    expect(result.constructionScopeLinks?.map(row => row.relation.mainId)).toEqual([f.secondMain.id, f.main.id])
    const zero = await f.finance.execute({ ...request, commandId: 'new-draft-only-zero', draft: { ...request.draft, constructionMain: choice(mainB), lines: [{ amount: 0, expenseItem: '' }] } }, f.session)
    await f.storage.close()
    const zeroForm = await f.finance.form('reimbursement', zero.id, f.session)
    expect(zeroForm.draft.lines).toEqual([])
    expect(zeroForm.draft.constructionMain).toEqual(choice(mainB))
    expect(zero.constructionScopeLinks).toBeUndefined()
    expect((await f.storage.withTransaction(tx => readProductionConstructionSpending(tx, f.actor, f.project.id))).metrics).toEqual(beforeCost.metrics)
    expect(await f.storage.select('SELECT * FROM payment_records')).toEqual([])
    await f.storage.withTransaction(validateProductionConstructionScopeState)
  }
  finally { await f.storage.close() }
})

it('项目工资实际净额只需工资与本面授权，不借预算权；撤工资权未知且不泄露冻结个人资料', async () => {
  const f = await createConstructionScopeFixture()
  try {
    f.actor.capabilities.push('payroll:read', 'payroll:write', 'worker:list:read', 'crew:list:read')
    const now = '2026-10-07T00:00:00.000Z'
    await f.storage.withTransaction(async (tx) => {
      await tx.execute('INSERT INTO crews(id,record_json) VALUES (?,?)', ['scope-wage-crew', JSON.stringify({ id: 'scope-wage-crew', version: 1, updatedAt: now, draft: { id: 'scope-wage-crew', name: '工资原班组' } })])
      await tx.execute('INSERT INTO workers(id,record_json) VALUES (?,?)', ['scope-wage-worker', JSON.stringify({ id: 'scope-wage-worker', version: 1, updatedAt: now, draft: { id: 'scope-wage-worker', name: '工资隐私原姓名', crewId: 'scope-wage-crew', currentProjectId: f.project.id, dailyWage: 100 } })])
    })
    const payroll = createProductionPayrollService(f.storage).forSession(f.session)
    const scope = { projectId: f.project.id, crewId: 'scope-wage-crew', month: '2026-10' }
    const matrix = await payroll.attendanceMatrix({ origin: 'real' }, scope)
    await payroll.executeAttendance({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'scope-payroll-real-attendance', origin: 'real', requiredCapability: 'payroll:write', projectId: f.project.id, scope, sourceVersion: matrix.context.sourceVersion, action: { kind: 'upsert-attendance', record: { workerId: 'scope-wage-worker', crewId: scope.crewId, workDate: '2026-10-01', hours: 8, overtimeHours: 0, workContent: '真实项目原考勤', note: '' } } })
    const draft = { ...scope, leaderWorkerId: 'scope-wage-worker', memberWorkerIds: ['scope-wage-worker'], note: '冻结原工资隐私备注' }
    const form = await payroll.c1Form({ origin: 'real' }, { statementId: null, draftKey: 'scope-wage-original', draft })
    const base = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, projectId: f.project.id, configScope: null }
    const saved = await payroll.executeC1({ ...base, commandId: 'scope-wage-save', sourceVersion: form.context.sourceVersion, statementId: null, draftKey: form.draftKey, action: { kind: 'save-c1-draft', draft } })
    const current = await payroll.c1Form({ origin: 'real' }, { statementId: saved.statementId! })
    await payroll.executeC1({ ...base, commandId: 'scope-wage-check', sourceVersion: current.context.sourceVersion, statementId: saved.statementId, draftKey: null, action: { kind: 'check-c1' } })
    const checked = await payroll.c1Form({ origin: 'real' }, { statementId: saved.statementId! })
    await payroll.executeC1({ ...base, commandId: 'scope-wage-actual-release', sourceVersion: checked.context.sourceVersion, statementId: saved.statementId, draftKey: null, action: { kind: 'release-c1', release: { actualAmount: 90, allocations: [{ workerId: 'scope-wage-worker', amount: 90 }] } } })
    expect(f.actor.capabilities).not.toContain('target-cost:read')
    const read = await f.storage.withTransaction(tx => readProductionConstructionSpending(tx, f.actor, f.project.id))
    expect(read.projectPayroll).toEqual({ scope: 'project', knownPaidAmount: 90, complete: true })
    expect(JSON.stringify(read)).not.toContain('工资隐私原姓名')
    expect(JSON.stringify(read)).not.toContain('冻结原工资隐私备注')
    f.actor.capabilities = f.actor.capabilities.filter(cap => cap !== 'payroll:read')
    const forbidden = await f.storage.withTransaction(tx => readProductionConstructionSpending(tx, f.actor, f.project.id))
    expect(forbidden.projectPayroll).toEqual({ scope: 'project', knownPaidAmount: null, complete: false })
    expect(JSON.stringify(forbidden)).not.toContain('工资隐私原姓名')
    expect(forbidden.rows.every(row => !row.identity.startsWith('real:payroll:'))).toBe(true)
  }
  finally { await f.storage.close() }
})

it('分包承诺只读真实原主补记录及singleMain，不二记原费用或现金；撤分包权总额未知且已知材采保留', async () => {
  const f = await createConstructionScopeFixture()
  try {
    f.actor.capabilities.push('subcontract-contract:write')
    const main = await f.storage.withTransaction(tx => readProductionConstructionScopeMainFact(tx, f.actor, f.main.id))
    const service = createProductionSubcontractContractService(f.storage)
    const request = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'scope-real-subcontract', requiredCapability: 'subcontract-contract:write', action: 'submit' as const, baseVersion: null, constructionMain: { id: main.id, projectId: f.project.id, basis: main.basis }, draft: { name: '真实分包承诺源', no: 'SCOPE-SUB', subKind: '劳务', projectId: f.project.id, supplierId: f.supplier.id, content: '原分包施工范围', signDate: '2026-10-07', amount: 125, taxRate: 0, ourSignatoryId: f.signatory.id, ourSignatoryVersion: f.signatory.version }, attachments: { add: [{ fileName: '原分包.pdf', mimeType: 'application/pdf', fileSize: 3, payloadBase64: 'YWJj' }] } }
    const saved = await service.execute(request, f.session)
    const beforeExpenses = await f.storage.select('SELECT * FROM expense_reimbursement_lines ORDER BY id')
    const read = await f.storage.withTransaction(tx => readProductionConstructionSpending(tx, f.actor, f.project.id, f.main.id))
    expect(read.rows.filter(row => row.metric === 'committed')).toEqual(expect.arrayContaining([expect.objectContaining({ identity: `subcontract:${saved.id}`, sourceId: saved.id, mainId: f.main.id, amount: 125 })]))
    expect(read.metrics.committed).toEqual({ knownAmount: 225, amount: 225, complete: true })
    expect(read.metrics.incurred).toEqual({ knownAmount: 100, amount: 100, complete: true })
    expect(read.rows.filter(row => row.metric === 'paid')).toEqual([])
    expect(read.sources.find(row => row.key === 'subcontract-contract')?.state).toBe('readable')
    expect(await f.storage.select('SELECT * FROM expense_reimbursement_lines ORDER BY id')).toEqual(beforeExpenses)
    expect(await f.storage.select('SELECT * FROM payment_records')).toEqual([])
    await f.storage.close()
    expect((await f.storage.withTransaction(tx => readProductionConstructionSpending(tx, f.actor, f.project.id, f.main.id))).metrics.committed).toEqual(read.metrics.committed)
    f.actor.capabilities = f.actor.capabilities.filter(cap => cap !== 'subcontract-contract:read')
    const denied = await f.storage.withTransaction(tx => readProductionConstructionSpending(tx, f.actor, f.project.id, f.main.id))
    expect(denied.metrics.committed).toEqual({ knownAmount: 100, amount: null, complete: false })
    expect(denied.sources.find(row => row.key === 'subcontract-contract')?.state).toBe('forbidden')
    expect(JSON.stringify(denied)).not.toContain('真实分包承诺源')
  }
  finally { await f.storage.close() }
})

it('真实其他支出合同同tx关联后进入Other候选和承诺，公司头始终独立且不造费用或支付', async () => {
  const f = await createConstructionScopeFixture()
  try {
    f.actor.capabilities.push('auxiliary-contract:write', 'other-settlement:read', 'other-settlement:write')
    const main = await f.storage.withTransaction(tx => readProductionConstructionScopeMainFact(tx, f.actor, f.main.id))
    const auxiliary = createProductionAuxiliaryContractService(f.storage)
    const base = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'auxiliary-contract:write', baseVersion: null, action: 'submit' as const, attachments: { add: [{ fileName: '原项目服务合同.txt', mimeType: 'text/plain', fileSize: 3, payloadBase64: 'YWJj' }] } }
    const saved = await auxiliary.execute({ ...base, commandId: 'scope-real-aux-other', constructionMain: { id: main.id, projectId: f.project.id, basis: main.basis }, draft: { kind: 'other_expense', name: '实际检测服务合同', no: 'SCOPE-AUX-OTHER', projectId: f.project.id, supplierId: f.supplier.id, category: '检测服务', signDate: '2026-10-07', amount: 200, taxRate: 0, ourSignatoryId: f.signatory.id, ourSignatoryVersion: f.signatory.version } }, f.session)
    const company = await auxiliary.execute({ ...base, commandId: 'scope-real-aux-company', draft: { kind: 'company_expense', name: '独立公司合同', no: 'SCOPE-AUX-COMPANY', supplierId: f.supplier.id, supplierVersion: f.supplier.version, category: '软件', signDate: '2026-10-07', amount: 50, taxRate: 0, ourSignatoryId: f.signatory.id, ourSignatoryVersion: f.signatory.version } }, f.session)
    const other = createProductionOtherSettlementService(f.storage)
    const context = await other.context(f.session)
    expect(context.contracts).toEqual([expect.objectContaining({ id: saved.id, kind: 'other_expense', projectId: f.project.id, supplierId: f.supplier.id, amount: '200.00', changedAmount: '200.00' })])
    expect(context.contracts.some(row => row.id === company.id)).toBe(false)
    expect(await f.storage.select('SELECT project_id,supplier_id FROM auxiliary_contract_records WHERE id=?', [company.id])).toEqual([{ project_id: null, supplier_id: f.supplier.id }])
    const spending = await f.storage.withTransaction(tx => readProductionConstructionSpending(tx, f.actor, f.project.id, f.main.id))
    expect(spending.rows.filter(row => row.metric === 'committed').map(row => [row.sourceId, row.amount])).toEqual(expect.arrayContaining([[f.material.id, 100], [saved.id, 200]]))
    expect(spending.metrics.committed).toEqual({ knownAmount: 300, amount: 300, complete: true })
    expect(spending.rows.some(row => row.sourceId === company.id)).toBe(false)
    expect(spending.metrics.incurred).toEqual({ knownAmount: 100, amount: 100, complete: true })
    expect(await f.storage.select('SELECT * FROM payment_records')).toEqual([])
    const source = { domain: 'auxiliary-contract' as const, id: saved.id }
    const original = constructionScopeCommand(await f.scope.read(source, f.session), 'scope-aux-exact-original', f.main.id)
    const linked = await f.scope.execute(original, f.session)
    const descriptor = { commandId: original.commandId, workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, family: 'construction-scope', action: 'bind', targetId: constructionScopeSourceKey(source), scopeId: saved.id }
    await expect(f.scope.resolve({ ...descriptor, scopeId: f.expense.id }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await f.storage.close()
    const child = await runColdProcess('production-construction-scope-cold', [], { env: { ...process.env, CRM_CONSTRUCTION_SCOPE_COLD: JSON.stringify({ options: f.options, actor: f.actor, descriptors: [descriptor] }) } })
    expect(JSON.parse(child.stdout).results).toEqual([{ outcome: 'applied', result: linked }])
    await f.storage.withTransaction(validateProductionConstructionScopeState)
    f.actor.capabilities = f.actor.capabilities.filter(cap => cap !== 'auxiliary-contract:read')
    const denied = await other.context(f.session)
    expect(denied.contracts).toEqual([])
    expect(denied.meta.sources.find(row => row.key === 'auxiliary-contracts')?.state).toBe('forbidden')
    expect(JSON.stringify(denied)).not.toContain('实际检测服务合同')
  }
  finally { await f.storage.close() }
})

it('other新原费用消费只核所选金额/身份/资格：另一同头行及全局财务修订可保存，选定金额改变拒；原版本及冻结证据原样保', async () => {
  const f = await createConstructionScopeFixture()
  try {
    f.actor.capabilities.push('other-settlement:read', 'other-settlement:write')
    const other = createProductionOtherSettlementService(f.storage)
    const sources = await other.expenses(f.session)
    const selected = sources.items.find(row => row.id === f.expenseId)!
    const sourceVersion = selected.version
    const sourceRevision = selected.sourceRevision
    const draft = { name: '真实选定原费用采用', projectId: f.project.id, supplierId: f.supplier.id, totalAmount: 20, taxRate: 0, settlementDate: '2026-10-07', originalExpenses: [{ originalExpenseLineId: selected.id, sourceVersion, sourceRevision, consumptionVersion: selected.consumptionVersion, amount: 20 }] }
    const current = await f.finance.form('reimbursement', f.expense.id, f.session)
    await f.finance.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'other-unconsumed-line-change', requiredCapability: 'finance-reimbursement:write', kind: 'reimbursement', id: f.expense.id, baseVersion: current.version, action: 'save', draft: { ...current.draft, lines: current.draft.lines.map(row => row.id === f.otherExpenseId ? { ...row, amount: 70 } : row) }, attachments: {} }, f.session)
    const later = (await other.expenses(f.session)).items.find(row => row.id === selected.id)!
    expect(later.version).not.toBe(sourceVersion)
    expect(later.sourceRevision).not.toBe(sourceRevision)
    expect(later.consumptionVersion).toBe(selected.consumptionVersion)
    const command = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'other-settlement:write', commandId: 'other-selected-vector-original', baseVersion: null, action: 'submit' as const, draft, attachments: {} }
    const saved = await other.execute(command, f.session)
    expect(await other.execute(command, f.session)).toEqual(saved)
    const read = await other.detail(saved.id, { origin: 'real' }, f.session)
    expect(read.settlement.draft.originalExpenses?.[0]).toMatchObject({ sourceVersion, sourceRevision, consumptionVersion: selected.consumptionVersion })
    const frozen = JSON.parse((await f.storage.select<{ frozen_json: string }>('SELECT frozen_json FROM expenditure_settlement_expense_allocations WHERE settlement_id=?', [saved.id]))[0]!.frozen_json)
    expect(frozen.version).toBe(later.version)
    expect(frozen.sourceRevision).toBe(later.sourceRevision)
    const fresh = await f.finance.form('reimbursement', f.expense.id, f.session)
    await f.finance.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'other-selected-line-change', requiredCapability: 'finance-reimbursement:write', kind: 'reimbursement', id: f.expense.id, baseVersion: fresh.version, action: 'save', draft: { ...fresh.draft, lines: fresh.draft.lines.map(row => row.id === f.expenseId ? { ...row, amount: 41 } : row) }, attachments: {} }, f.session)
    await expect(other.execute({ ...command, commandId: 'other-stale-selected-vector' }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await other.resolve(command.commandId, f.session)).toEqual({ outcome: 'applied', result: saved })
    expect(await f.storage.select('SELECT id FROM expenditure_settlements')).toEqual([{ id: saved.id }])
  }
  finally { await f.storage.close() }
})

it('跨Main原费用采用的实际银行项目金额仍已知，Main归属待核且不均摊、不重复Other原费用', async () => {
  const f = await createConstructionScopeFixture()
  try {
    f.actor.capabilities.push('other-settlement:read', 'other-settlement:write')
    for (const [id, mainId] of [[f.expenseId, f.main.id], [f.otherExpenseId, f.secondMain.id]])
      await f.scope.execute(constructionScopeCommand(await f.scope.read({ domain: 'original-expense', id: id! }, f.session), `scope-cross-${id}`, mainId), f.session)
    const expenses = await f.storage.withTransaction(tx => listOriginalExpenseReferences(tx, f.actor, f.project.id))
    const other = createProductionOtherSettlementService(f.storage)
    const settlementCommand = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'scope-cross-actual-settlement', requiredCapability: 'other-settlement:write', baseVersion: null, action: 'submit', draft: { name: '两条原费用实际采用', projectId: f.project.id, supplierId: f.supplier.id, payeeSupplierId: f.supplier.id, totalAmount: 100, taxRate: 0, settlementDate: '2026-10-07', period: '2026-10', originalExpenses: expenses.map(row => ({ originalExpenseLineId: row.id, sourceVersion: row.version, sourceRevision: row.sourceRevision, amount: row.amount })) }, attachments: {} }
    const pending = await other.execute(settlementCommand, f.session)
    const settled = await other.execute({ ...settlementCommand, id: pending.id, commandId: 'scope-cross-confirm-settlement', baseVersion: pending.version, action: 'confirm' }, f.session)
    const finance = createProductionFinanceService(f.storage, { references: (tx, actor) => ({ expenditure_settlements: id => readProductionOtherSettlementReference(tx, actor, id) }) })
    const base = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, baseVersion: null, action: 'save' as const, attachments: {} }
    const app = await finance.execute({ ...base, commandId: 'scope-cross-paid-application', kind: 'payment_application', requiredCapability: 'finance-payment-application:write', draft: { name: '同项目两条原费用实际付款', projectId: f.project.id, supplierId: f.supplier.id, bizType: '项目费用', applyAmount: 20, approvedAmount: 20, status: 'approved', applyDate: '2026-10-07', applicant: '核验财务', invoiceState: '无需发票', settlementAllocations: [{ settlementId: settled.id, allocatedAmount: 20 }] } }, f.session)
    await finance.execute({ ...base, commandId: 'scope-cross-real-bank', action: 'confirm', kind: 'payment_record', requiredCapability: 'finance-payment-record:write', draft: { projectId: f.project.id, supplierId: f.supplier.id, payeeName: '真实材料及服务商', amount: 20, paymentDate: '2026-10-07', voucherNo: 'SCOPE-CROSS-VOUCHER', bankSerialNo: 'SCOPE-CROSS-BANK', confirmedBy: f.actor.actorId, applicationAllocations: [{ paymentApplicationId: app.id, allocatedAmount: 20 }] } }, f.session)
    const project = await f.storage.withTransaction(tx => readProductionConstructionSpending(tx, f.actor, f.project.id))
    expect(project.metrics.paid).toMatchObject({ knownAmount: 20, amount: 20 })
    expect(Object.fromEntries(project.rows.filter(row => row.metric === 'incurred').map(row => [row.sourceId, row.amount]))).toEqual({ [f.expenseId]: 40, [f.otherExpenseId]: 60 })
    expect(project.rows.filter(row => row.metric === 'paid')).toMatchObject([{ amount: 20, mainId: null }])
    for (const mainId of [f.main.id, f.secondMain.id]) {
      const main = await f.storage.withTransaction(tx => readProductionConstructionSpending(tx, f.actor, f.project.id, mainId))
      expect(main.metrics.paid).toMatchObject({ knownAmount: 0, amount: null, complete: false })
      expect(main.rows.filter(row => row.metric === 'paid')).toEqual([])
      expect(main.unassigned.filter(row => row.metric === 'paid')).toMatchObject([{ amount: 20, mainId: null }])
    }
  }
  finally { await f.storage.close() }
})

it('实际付款只读原银行确认及精确分摊，费用/申请/结算不冒充现金；归属仅沿原材料合同', async () => {
  const f = await createConstructionScopeFixture()
  try {
    const source = { domain: 'material-contract' as const, id: f.material.id }
    await f.scope.execute(constructionScopeCommand(await f.scope.read(source, f.session), 'scope-paid-source', f.main.id), f.session)
    const base = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, baseVersion: null, action: 'save' as const, attachments: {} }
    const app = await f.finance.execute({ ...base, commandId: 'scope-actual-material-application', kind: 'payment_application', requiredCapability: 'finance-payment-application:write', draft: { name: '已批材料预付款', projectId: f.project.id, contractId: f.material.id, contractReference: { domain: 'material', id: f.material.id, version: f.material.version }, supplierId: f.supplier.id, bizType: '预付款', applyAmount: 20, approvedAmount: 20, status: 'approved', prepay: true, applyDate: '2026-10-07', applicant: '核验财务', invoiceState: '无需发票' } }, f.session)
    const before = await f.storage.withTransaction(tx => readProductionConstructionSpending(tx, f.actor, f.project.id, f.main.id))
    expect(before.metrics.committed.amount).toBe(100)
    expect(before.metrics.paid.amount).toBe(0)
    const cash = await f.finance.execute({ ...base, commandId: 'scope-real-bank-payment', action: 'confirm', kind: 'payment_record', requiredCapability: 'finance-payment-record:write', draft: { projectId: f.project.id, supplierId: f.supplier.id, payeeName: '真实材料及服务商', amount: 20, paymentDate: '2026-10-07', voucherNo: 'SCOPE-VOUCHER', bankSerialNo: 'SCOPE-BANK', confirmedBy: f.actor.actorId, applicationAllocations: [{ paymentApplicationId: app.id, allocatedAmount: 20 }] } }, f.session)
    const paid = await f.storage.withTransaction(tx => readProductionConstructionSpending(tx, f.actor, f.project.id, f.main.id))
    expect(paid.metrics.paid).toMatchObject({ amount: 20, knownAmount: 20 })
    expect(paid.rows.filter(row => row.metric === 'paid')).toMatchObject([{ sourceId: cash.id, amount: 20, mainId: f.main.id }])
    expect(Object.fromEntries(paid.rows.filter(row => row.metric === 'incurred').map(row => [row.sourceId, row.amount]))).toEqual({ [f.expenseId]: 40, [f.otherExpenseId]: 60 })
    expect(paid.unassigned.filter(row => row.metric === 'incurred')).toEqual([])
    expect(paid.rows.map(row => row.identity)).toEqual([...new Set(paid.rows.map(row => row.identity))])
    const originalBank = await f.storage.select('SELECT * FROM payment_records WHERE id=?', [cash.id])
    await f.storage.withTransaction(tx => readProductionConstructionSpending(tx, f.actor, f.project.id))
    expect(await f.storage.select('SELECT * FROM payment_records WHERE id=?', [cash.id])).toEqual(originalBank)
  }
  finally { await f.storage.close() }
})

it('消费所选原费用/主合同资格，不消费另一明细、清偿金额、主合同管理费或全库修订', async () => {
  const f = await createConstructionScopeFixture()
  try {
    const source = { domain: 'original-expense' as const, id: f.expenseId }
    const read = await f.scope.read(source, f.session)
    const current = await f.finance.form('reimbursement', f.expense.id, f.session)
    await f.finance.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'finance-reimbursement:write', commandId: 'scope-other-line-only', kind: 'reimbursement', id: f.expense.id, baseVersion: current.version, action: 'save', draft: { ...current.draft, lines: current.draft.lines.map(row => row.id === f.otherExpenseId ? { ...row, amount: 70 } : row) }, attachments: {} }, f.session)
    const main = await f.construction.form(f.main.id, f.session)
    await f.construction.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'construction-contract:write', commandId: 'scope-main-config-only', id: f.main.id, baseVersion: main.version, action: 'save', draft: { ...main.draft, managementFeeAmount: 10, managementFeeBasis: '变更配置而非关系资格' }, attachments: {} }, f.session, f.main.id)
    expect((await f.scope.read(source, f.session)).sourceBasis).toBe(read.sourceBasis)
    await f.scope.execute(constructionScopeCommand(read, 'scope-selected-basis', f.main.id), f.session)
    const later = await f.scope.read({ domain: 'original-expense', id: f.otherExpenseId }, f.session)
    const changed = await f.finance.form('reimbursement', f.expense.id, f.session)
    await f.finance.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'finance-reimbursement:write', commandId: 'scope-selected-line-change', kind: 'reimbursement', id: f.expense.id, baseVersion: changed.version, action: 'save', draft: { ...changed.draft, lines: changed.draft.lines.map(row => row.id === f.otherExpenseId ? { ...row, amount: 80 } : row) }, attachments: {} }, f.session)
    await expect(f.scope.execute(constructionScopeCommand(later, 'scope-stale-selected-amount', f.main.id), f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const otherRead = await f.scope.read({ domain: 'original-expense', id: f.otherExpenseId }, f.session)
    await f.scope.execute(constructionScopeCommand(otherRead, 'scope-other-expense-main-b', f.secondMain.id), f.session)
    const spending = await f.storage.withTransaction(tx => readProductionConstructionSpending(tx, f.actor, f.project.id, f.main.id))
    expect(spending.rows.filter(row => row.metric === 'incurred')).toMatchObject([{ identity: `expense:${f.expenseId}`, amount: 40 }])
    expect(spending.rows.some(row => row.identity === `expense:${f.otherExpenseId}`)).toBe(false)
    expect(spending.metrics.incurred).toMatchObject({ knownAmount: 40, amount: 40, complete: true })
    expect(spending.projectPayroll.scope).toBe('project')
    expect(spending.sources.find(row => row.key === 'auxiliary-contract')?.state).toBe('readable')
  }
  finally { await f.storage.close() }
})

it('原事实和回执同事务回滚；独立进程只恢复原回执，intent-only封存且拒迟到、错head与撤权恢复', async () => {
  const f = await createConstructionScopeFixture()
  try {
    const source = { domain: 'material-contract' as const, id: f.material.id }
    const read = await f.scope.read(source, f.session)
    const request = constructionScopeCommand(read, 'scope-reliable-original', f.main.id)
    const saved = await f.scope.execute(request, f.session)
    const expenseSource = { domain: 'original-expense' as const, id: f.expenseId }
    const expenseRead = await f.scope.read(expenseSource, f.session)
    const failed = constructionScopeCommand(expenseRead, 'scope-intent-only-fault', f.main.id)
    const fault = createProductionConstructionScopeService({ ...f.storage, withTransaction: async <T>(work: (tx: TransactionDb) => Promise<T>) => f.storage.withTransaction(tx => work({ ...tx, execute: async (sql, params) => {
      if (sql.startsWith('INSERT INTO construction_scope_receipts'))
        throw new Error('injected receipt disk failure')
      return tx.execute(sql, params)
    } })) })
    await expect(fault.execute(failed, f.session)).rejects.toThrow('injected receipt disk failure')
    expect((await f.scope.read(expenseSource, f.session)).relation).toEqual(expenseRead.relation)
    const descriptor = (input: typeof request, parentId: string): CommandRecoveryDescriptor => ({ commandId: input.commandId, workspaceId: input.workspaceId, actorId: input.actorId, family: 'construction-scope', targetId: constructionScopeSourceKey(input.source), scopeId: parentId, action: input.action })
    const descriptors = [descriptor(request, read.parentId), descriptor(failed, expenseRead.parentId)]
    await expect(f.scope.resolve({ ...descriptors[1]!, scopeId: f.material.id }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const priorCaps = [...f.actor.capabilities]
    f.actor.capabilities = priorCaps.filter(cap => cap !== 'material-contract:read')
    await expect(f.scope.resolve(descriptors[0]!, f.session)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    f.actor.capabilities = priorCaps
    await f.storage.close()
    const child = await runColdProcess('production-construction-scope-cold', [], { env: { ...process.env, CRM_CONSTRUCTION_SCOPE_COLD: JSON.stringify({ options: f.options, actor: f.actor, descriptors }) } })
    expect(JSON.parse(child.stdout).results).toEqual([{ outcome: 'applied', result: saved }, { outcome: 'not-applied', commandId: failed.commandId }])
    await expect(f.scope.execute(failed, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(f.scope.execute({ ...request, mainId: f.secondMain.id }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await f.scope.resolve(descriptors[0]!, f.session)).toEqual({ outcome: 'applied', result: saved })
    await f.storage.withTransaction(validateProductionConstructionScopeState)
  }
  finally { await f.storage.close() }
})
