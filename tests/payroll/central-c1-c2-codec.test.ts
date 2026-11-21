import type { PayrollC2FrozenDocument } from '~/lib/payroll/central-c2-contract'
import { beforeAll, describe, expect, it } from 'vitest'
import { encodePayrollAttendanceWire, parsePayrollAttendanceCommand } from '~/lib/payroll/central-attendance-codec'
import { encodePayrollC1Wire, parsePayrollC1Command } from '~/lib/payroll/central-c1-codec'
import { decodePayrollC2Read, decodePayrollC2Result, encodePayrollC2Wire, isPayrollC2FrozenDocument, parsePayrollC2Command } from '~/lib/payroll/central-c2-codec'
import { decodePayrollDayworkRead, decodePayrollDayworkResult, encodePayrollDayworkWire } from '~/lib/payroll/central-daywork-codec'
import { transformPayrollC1Wire, transformPayrollC2Wire } from '~/lib/payroll/central-payroll-wire'
import { createCheckedPayrollC2, createPayrollC2ServiceFixture } from '../helpers/payroll-c2-service-fixture'

const envelope = { commandId: 'cmd', workspaceId: 'workspace', actorId: 'actor', origin: 'real', sourceVersion: 'read', requiredCapability: 'payroll:write', projectId: 'p' }
it('考勤与 C1 命令封闭动作/字段，正常小数不提前舍入，非数与非法日期不能入请求', () => {
  const attendance = { ...envelope, scope: { projectId: 'p', month: '2026-08', crewId: null }, action: { kind: 'upsert-attendance', record: { workerId: 'w', crewId: null, workDate: '2026-08-01', hours: 7.51, overtimeHours: 0, workContent: '', note: '' } } }
  expect(parsePayrollAttendanceCommand(encodePayrollAttendanceWire(attendance))).toEqual(attendance)
  const config = { ...envelope, statementId: null, draftKey: null, configScope: { projectId: 'p', month: '2026-08', crewId: null }, action: { kind: 'save-c1-rates', rates: [{ workerId: 'w', dailyWage: null, overtimeRate: 60.125 }] } }
  expect(parsePayrollC1Command(encodePayrollC1Wire(config))).toEqual(config)
})

it.each([
  { label: '非真实日期', change: { workDate: '2026-02-30' }, reason: '考勤日期、工时或固定范围无效' },
  { label: '负工时', change: { hours: -1 }, reason: '考勤日期、工时或固定范围无效' },
  { label: '工时加加班超过 24 小时', change: { hours: 24, overtimeHours: 1 }, reason: '考勤日期、工时或固定范围无效' },
  { label: '工时非数', change: { hours: NaN }, reason: '金额须精确到分，工时与费率须为有限数值或明确空值' },
  { label: '工时无穷大', change: { hours: Infinity }, reason: '金额须精确到分，工时与费率须为有限数值或明确空值' },
  { label: '伪造记录身份', change: { recordId: 'forged' }, reason: '请求包含不支持的字段' },
])('考勤命令拒绝$label', ({ change, reason }) => {
  const attendance = { ...envelope, scope: { projectId: 'p', month: '2026-08', crewId: null }, action: { kind: 'upsert-attendance', record: { workerId: 'w', crewId: null, workDate: '2026-08-01', hours: 7.51, overtimeHours: 0, workContent: '', note: '' } } }
  expect(parsePayrollAttendanceCommand(encodePayrollAttendanceWire(attendance))).toEqual(attendance)
  expect(() => parsePayrollAttendanceCommand(encodePayrollAttendanceWire({ ...attendance, action: { ...attendance.action, record: { ...attendance.action.record, ...change } } }))).toThrow(reason)
})

it.each([
  { label: '核对动作夹带比例', action: { kind: 'check-c1', payRatio: 0.8 }, reason: '请求包含不支持的字段' },
  { label: '发放动作夹带事实', action: { kind: 'release-c1', facts: [] }, reason: '请求包含不支持的字段' },
  { label: '未开放的删除动作', action: { kind: 'delete-c1' }, reason: 'C1 动作无效' },
  { label: '串用 A 表动作', action: { kind: 'check-a' }, reason: 'C1 动作无效' },
])('c1 命令拒绝$label', ({ action, reason }) => {
  const attendance = { ...envelope, scope: { projectId: 'p', month: '2026-08', crewId: null }, action: { kind: 'upsert-attendance', record: { workerId: 'w', crewId: null, workDate: '2026-08-01', hours: 7.51, overtimeHours: 0, workContent: '', note: '' } } }
  expect(parsePayrollAttendanceCommand(encodePayrollAttendanceWire(attendance))).toEqual(attendance)
  const config = { ...envelope, statementId: null, draftKey: null, configScope: { projectId: 'p', month: '2026-08', crewId: null }, action: { kind: 'save-c1-rates', rates: [{ workerId: 'w', dailyWage: null, overtimeRate: 60.125 }] } }
  expect(parsePayrollC1Command(encodePayrollC1Wire(config))).toEqual(config)
  expect(() => parsePayrollC1Command(encodePayrollC1Wire({ ...config, statementId: 'wage', configScope: null, action }))).toThrow(reason)
})

it.each(Array.from([null, 0, 350.125, 0.0000001, 1e21, Number.MIN_VALUE, Number.MAX_VALUE, -0.0000001]).map(input => ({ input })))('签工C2有限数精确展开十进制定点，null与零保真，科学计数传输不能进入读取或命令：输入组合 1 案例 %#', ({ input: unitRate }) => {
  const wire = encodePayrollC2Wire({ unitRate })
  expect(wire).toEqual({ unitRate: unitRate === null ? null : expect.stringMatching(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/) })
  expect(transformPayrollC2Wire(wire, true)).toEqual({ unitRate })
})

it.each(Array.from(['1e-7', '1E+21', '3.5e2']).map(input => ({ input })))('签工C2有限数精确展开十进制定点，null与零保真，科学计数传输不能进入读取或命令：输入组合 2 案例 %#', ({ input: unitRate }) => {
  expect(() => transformPayrollC2Wire({ unitRate }, true)).toThrow('签工工数、主体单价或金额传输格式无效')
})

describe('同一规范适用于已共享的C1有限费率，原缺值与到分金额不放宽', () => {
  const expected = { overtimeRate: '0.0000001', dailyWage: '1000000000000000000000', hours: '7.51', configuredDailyWage: null, amount: '350.13' }
  const source = { overtimeRate: 0.0000001, dailyWage: 1e21, hours: 7.51, configuredDailyWage: null, amount: 350.13 }
  it.each([
    { case: 'source / false', input: source, argument2: false, expected },
    { case: 'expected / true', input: expected, argument2: true, expected: source },
  ])('transformPayrollC1Wire：$case', ({ input, argument2, expected }) => {
    expect(transformPayrollC1Wire(structuredClone(input), structuredClone(argument2))).toEqual(expected)
  })
})

it.each([
  { case: '{ overtimeRate: \'1e-7\' } / true', input: { overtimeRate: '1e-7' }, argument2: true },
  { case: '{ amount: \'350.125\' } / true', input: { amount: '350.125' }, argument2: true },
])('同一规范适用于已共享的C1有限费率，原缺值与到分金额不放宽 / transformPayrollC1Wire：$case', ({ input, argument2 }) => {
  expect(() => transformPayrollC1Wire(input, argument2)).toThrow('工时、费率或金额传输格式无效')
})

it('公开读取拒绝错项目签工和错负责人配置，坏原日期仍保留原文', async () => {
  const f = await createPayrollC2ServiceFixture()
  try {
    await f.daywork()
    const list = await f.ledger()
    const wrongList = structuredClone(list)
    wrongList.records[0]!.projectId = 'other-project'
    expect(() => decodePayrollDayworkRead(encodePayrollDayworkWire(wrongList), 'list', { origin: 'real' }, f.scope)).toThrow('签工读取或提交内容不完整')
    await f.service.executeC2(f.c2Command(await f.c2Config(), { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 350.125, ruleText: '' } }))
    const config = await f.c2Config()
    const wrongConfig = structuredClone(config)
    wrongConfig.config!.leaderWorkerId = 'member'
    expect(() => decodePayrollC2Read(encodePayrollC2Wire(wrongConfig), 'config', { origin: 'real' }, config.scope)).toThrow('C2 读取或提交内容不完整')
    await f.db.execute('UPDATE signed_daywork_records SET work_date=\'旧日无法辨认\'')
    const bad = await f.ledger()
    expect(decodePayrollDayworkRead(encodePayrollDayworkWire(bad), 'list', { origin: 'real' }, f.scope)).toEqual(bad)
  }
  finally { await f.close() }
})

it('真实命令结果不能改原记录或伪造物理领用，未知正文不进入中央命令', async () => {
  const f = await createPayrollC2ServiceFixture()
  try {
    const command = f.dayworkCommand(await f.dayworkForm(), { kind: 'save-daywork', record: f.record })
    const result = await f.service.executeDaywork(command)
    expect(() => decodePayrollDayworkResult({ ...result, workerId: 'member' }, command)).toThrow('签工回执与原提交或记录不一致')
    const configCommand = f.c2Command(await f.c2Config(), { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 350.125, ruleText: '' } })
    const configResult = await f.service.executeC2(configCommand)
    expect(() => decodePayrollC2Result({ ...configResult, dayworkRecordIds: [result.recordId], dayworkLinkIds: ['fake-link'] }, configCommand)).toThrow('C2 回执的原签工与物理关联不完整')
    expect(() => parsePayrollC2Command(encodePayrollC2Wire({ ...configCommand, sourceRecordIds: [result.recordId] }))).toThrow('请求包含不支持的字段')
    expect(() => encodePayrollC2Wire({ actualAmount: 500.001 })).toThrow('金额须为到分数值，签工工数与主体单价须为有限数值或明确空值')
  }
  finally { await f.close() }
})

describe('真实发放后的 C2 冻结文档', () => {
  let frozen: PayrollC2FrozenDocument
  beforeAll(async () => {
    const f = await createPayrollC2ServiceFixture()
    try {
      const checked = await createCheckedPayrollC2(f)
      await f.service.executeC2(f.c2Command(checked, { kind: 'release-c2', release: { actualAmount: 500, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] } }))
      const read = await f.service.c2Output({ origin: 'real' }, checked.statementId!)
      if (read.state !== 'available')
        throw new Error('真实健康释放必须有冻结')
      frozen = read.document
    }
    finally { await f.close() }
  })

  it('完整冻结文档通过校验', () => {
    expect(isPayrollC2FrozenDocument(frozen)).toBe(true)
  })

  it.each([
    { label: '签工日期改到其他月份', mutate: (copy: PayrollC2FrozenDocument) => { copy.daywork[0]!.workDate = '2026-09-01' } },
    { label: '证明人被清空', mutate: (copy: PayrollC2FrozenDocument) => { copy.daywork[0]!.witness = '' } },
    { label: '签工班组被清空', mutate: (copy: PayrollC2FrozenDocument) => { copy.daywork[0]!.crewId = null } },
    { label: '原行正文被改写', mutate: (copy: PayrollC2FrozenDocument) => { copy.daywork[0]!.original.note = '假原文' } },
    { label: '零分配成员被删除', mutate: (copy: PayrollC2FrozenDocument) => { copy.allocations = copy.allocations.filter(a => a.workerId !== 'zero') } },
    { label: '期间档不是按月', mutate: (copy: PayrollC2FrozenDocument) => { (copy as { periodKind: string }).periodKind = 'cumulative' } },
    { label: '发放比例不是 1', mutate: (copy: PayrollC2FrozenDocument) => { (copy as { payRatio: number }).payRatio = 0.8 } },
  ])('拒绝$label', ({ mutate }) => {
    const copy = structuredClone(frozen)
    mutate(copy)
    expect(isPayrollC2FrozenDocument(copy)).toBe(false)
  })
})
