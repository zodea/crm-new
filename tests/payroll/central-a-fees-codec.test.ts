import type { PayrollAFeeConfigRead, PayrollAFeesFormRead, PayrollAFeesFrozenDocument } from '../../app/lib/payroll/central-a-fees-contract'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decodePayrollARead, encodePayrollAWire } from '../../app/lib/payroll/central-a-codec'
import { decodePayrollAFeeConfigRead, decodePayrollAFeesResult } from '../../app/lib/payroll/central-a-fees-codec'
import { createPayrollAFeesFixture } from '../helpers/payroll-a-fees-fixture'

describe('p5 费用 HTTP 读取的封闭嵌套边界', () => {
  const invalidData = expect.objectContaining({ problem: expect.objectContaining({ code: 'validation-failed' }) })
  let fixture: Awaited<ReturnType<typeof createPayrollAFeesFixture>>
  let config: PayrollAFeeConfigRead
  let form: PayrollAFeesFormRead
  let document: PayrollAFeesFrozenDocument
  let managementForm: PayrollAFeesFormRead
  beforeAll(async () => {
    fixture = await createPayrollAFeesFixture()
    await fixture.prices()
    await fixture.saveFees([fixture.fee()])
    config = await fixture.feeConfig()
    const draft = { ...fixture.draft, book: fixture.ordinary, payRatio: 1 }
    const saved = await fixture.service.execute(fixture.command(await fixture.form(draft), { kind: 'save-a-draft', draft }))
    form = await fixture.service.aForm({ origin: 'real' }, { statementId: saved.statementId! }) as PayrollAFeesFormRead
    await fixture.release(saved.statementId!, 3730)
    const output = await fixture.service.aOutput({ origin: 'real' }, saved.statementId!)
    if (output.state !== 'available')
      throw new Error(output.reasons.join('；'))
    document = output.document as PayrollAFeesFrozenDocument
    const management = await fixture.management()
    const started = await management.start()
    const current = await fixture.service.aForm({ origin: 'real' }, { statementId: started.statementId! }) as PayrollAFeesFormRead
    const scope = { assignments: management.scope.assignments.map(a => ({ ...a, cells: a.cells.filter(c => c.itemId === 'shower') })) }
    await fixture.service.executeFees(fixture.feeCommand(current, { kind: 'save-a-negative-lines', baseVersion: current.context.sourceVersion, lines: [{ lineId: null, baseRevisionId: null, label: '未收尾', quantity: 30, unit: '套', unitPrice: -2, scope, reason: '代付', evidenceNote: '原责任', actualRef: null }], remove: [] }))
    await fixture.release(started.statementId!, 252)
    const later = await management.start('2026-09')
    managementForm = await fixture.service.aForm({ origin: 'real' }, { statementId: later.statementId! }) as PayrollAFeesFormRead
  })
  afterAll(async () => fixture?.close())

  it('公开服务的配置、费用表单和冻结输出仍可读取', () => {
    expect(decodePayrollAFeeConfigRead(encodePayrollAWire(config), { origin: 'real' }, config.scope)).toEqual(config)
  })

  it.each([
    { case: '费用表单', input: () => form, view: 'form' as const, target: () => ({ statementId: form.statementId! }) },
    { case: '冻结输出', input: () => ({ context: { ...form.context, readonly: true }, statementId: document.id, state: 'available', document, reasons: [] }), view: 'output' as const, target: () => document.id },
  ])('公开服务的配置、费用表单和冻结输出仍可读取 / decodePayrollARead：$case', ({ input, view, target }) => {
    const expected = input()
    expect(decodePayrollARead(encodePayrollAWire(expected), view, { origin: 'real' }, target())).toEqual(expected)
  })
  const configCorruptions: Array<[string, (value: PayrollAFeeConfigRead) => void]> = [
    ['上下文缺工作区', v => Reflect.deleteProperty(v.context, 'workspaceId')],
    ['上下文缺读权限', v => Object.assign(v.context, { capabilities: [] })],
    ['可写状态与权限冲突', v => Object.assign(v.context, { readonly: true })],
    ['配置扩展未知字段', v => Object.assign(v, { guessedAmount: 0 })],
    ['分项为空', v => Object.assign(v, { items: [null] })],
    ['分项分类值不在合同内', v => Object.assign(v.items[0]!, { housingClassification: { state: 'value', value: 'guess' } })],
    ['选项缺嵌套集合', v => Object.assign(v, { options: {} })],
    ['原责任为空', v => Object.assign(v, { responsibilityOptions: [null] })],
    ['原责任格子身份非法', v => Object.assign(v.responsibilityOptions[0]!.cells[0]!, { unitId: null })],
    ['来源导航伪造直接链接', v => Object.assign(v.responsibilityOptions[0]!, { sources: [{ kind: 'entity-detail', href: 'https://example.com' }] })],
    ['阻断为空', v => Object.assign(v, { blockers: [null] })],
    ['历史为空', v => Object.assign(v, { history: [null] })],
    ['资格字段缺失', v => Reflect.deleteProperty(v.eligibility, 'canStartManagementDraft')],
    ['费用修订混入其他项目', v => Object.assign(v.fees[0]!, { projectId: 'other-project' })],
  ]
  it.each(configCorruptions)('%s 必须拒绝为坏响应', (_label, corrupt) => {
    const value = structuredClone(config)
    corrupt(value)
    expect(() => decodePayrollAFeeConfigRead(encodePayrollAWire(value), { origin: 'real' }, config.scope)).toThrow(invalidData)
  })
  const feeCorruptions: Array<[string, (value: PayrollAFeesFrozenDocument['fees']) => void]> = [
    ['费用原量事实缺字段', v => Object.assign(v.lines[0]!.components[0]!, { fact: {} })],
    ['费用来源为 null', v => Object.assign(v.lines[0]!, { sources: [null] })],
    ['费用阻断为 null', v => Object.assign(v.lines[0]!, { blockers: [null] })],
    ['费用组成缺管理用途字段', v => Reflect.deleteProperty(v.lines[0]!.components[0]!, 'managementOwnership')],
    ['费用组成多猜测字段', v => Object.assign(v.lines[0]!.components[0]!, { inferred: true })],
    ['费用修订多猜测字段', v => Object.assign(v.feeRevisions[0]!, { inferred: true })],
  ]
  it.each(feeCorruptions)('表单和冻结输出拒绝：%s', (_label, corrupt) => {
    const read = structuredClone(form)
    corrupt(read.fees!)
    expect(() => decodePayrollARead(encodePayrollAWire(read), 'form', { origin: 'real' }, { statementId: read.statementId! })).toThrow(invalidData)
    const output = { context: { ...form.context, readonly: true }, statementId: document.id, state: 'available', document: structuredClone(document), reasons: [] }
    corrupt(output.document.fees)
    expect(() => decodePayrollARead(encodePayrollAWire(output), 'output', { origin: 'real' }, document.id)).toThrow(invalidData)
  })
  it('用途未证分支也验证此前已领、负价稿和费用阻断', () => {
    const read = { ...structuredClone(form), book: null, fees: null, bookProof: { state: 'unproven', book: null, reasons: ['原用途不可证'] }, bookEligibility: { canSave: false, canCheck: false, canRelease: false, reasons: ['原用途不可证'] }, previousBookPayments: [null] }
    expect(() => decodePayrollARead(encodePayrollAWire(read), 'form', { origin: 'real' }, { statementId: form.statementId! })).toThrow(invalidData)
  })
  it.each(Array.from(([
    r => Object.assign(r.fees!.management!.book, { managerWorkerId: 42 }),
    r => Object.assign(r.fees!.management!.revision, { scope: null }),
    r => Object.assign(r.fees!.managementOwnership[0]!.proof, { fact: {} }),
    r => Object.assign(r.fees!.negativeLines[0]!, { actualRef: { kind: 'actual-event' } }),
    r => Object.assign(r.fees!.negativeLines[0]!, { extra: 0 }),
    r => Object.assign(r.previousBookPayments[0]!, { actualRefs: [null] }),
    r => Object.assign(r, { negativeLineDrafts: [{ lineId: null, baseRevisionId: null }] }),
    r => Object.assign(r, { negativeLineRevisions: [null] }),
  ]) as Array<(read: PayrollAFeesFormRead) => void>).map(input => ({ input })))('管理原量、永久归属、此前已领和负价引用逐层验证：输入案例 %#', ({ input: corrupt }) => {
    const decode = (read: unknown) => decodePayrollARead(encodePayrollAWire(read), 'form', { origin: 'real' }, { statementId: managementForm.statementId! })
    expect(decode(managementForm)).toEqual(managementForm)

    const value = structuredClone(managementForm)
    corrupt(value)
    expect(() => decode(value)).toThrow(invalidData)
  })
  function createFeeCommandReceipt() {
    const command = fixture.feeCommand(config, { kind: 'save-a-fees', baseVersion: config.baseVersion, fees: [], remove: [] })
    const result = { commandId: command.commandId, projectId: command.projectId, statementId: null, subjectConfigId: null, priceRevisionIds: [], sourceVersion: 'version', outcome: 'saved', logIds: [], book: command.book, managementBookId: null, managementRevisionId: null, feeRevisionIds: [], negativeLineRevisionIds: [], locatedExistingDraft: false }
    expect(decodePayrollAFeesResult(result, command)).toEqual(result)
    const value = structuredClone(result)
    Reflect.deleteProperty(value, 'subjectConfigId')
    return { command, result, value }
  }

  it('费用回执也不能缺失继承字段或错配原单', () => {
    createFeeCommandReceipt()
  })

  it.each([
    { case: 'value / command', prepare: ({ command, value }: ReturnType<typeof createFeeCommandReceipt>) => {
      return { input: value, argument2: command } as const
    } },
    { case: '{ ...result, statementId: \'other\' } / { ...command, statementId: \'original\' }', prepare: ({ command, result }: ReturnType<typeof createFeeCommandReceipt>) => {
      const value = structuredClone(result)
      Reflect.deleteProperty(value, 'subjectConfigId')
      return { input: { ...result, statementId: 'other' }, argument2: { ...command, statementId: 'original' } } as const
    } },
  ])('费用回执也不能缺失继承字段或错配原单 / decodePayrollAFeesResult：$case', ({ prepare }) => {
    const fixture = createFeeCommandReceipt()
    const { input, argument2 } = prepare(fixture)
    expect(() => decodePayrollAFeesResult(input, argument2)).toThrow(invalidData)
  })
  it('原负价证据失效仍能读取真实不可用诊断，不能用于冻结输出', async () => {
    const old = managementForm.fees!.negativeLines[0]!
    await fixture.db.execute('UPDATE payroll_a_negative_lines SET evidence_note=? WHERE id=?', ['与原确认内容不同', old.id])
    const target = { statementId: managementForm.statementId! }
    const read = await fixture.service.aForm({ origin: 'real' }, target) as PayrollAFeesFormRead
    expect(read.fees!.totals.negativeAmount.state).toBe('unknown')
    expect(read.bookEligibility.canCheck).toBe(false)
    expect(decodePayrollARead(encodePayrollAWire(read), 'form', { origin: 'real' }, target)).toEqual(read)
    const invalidOutput = { context: { ...read.context, readonly: true }, statementId: document.id, state: 'available', document: { ...document, book: read.book, fees: read.fees }, reasons: [] }
    expect(() => decodePayrollARead(encodePayrollAWire(invalidOutput), 'output', { origin: 'real' }, document.id)).toThrow(invalidData)
  })
})
