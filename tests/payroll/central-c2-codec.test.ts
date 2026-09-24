import { expect, it } from 'vitest'
import { decodePayrollC2Read, decodePayrollC2Result, encodePayrollC2Wire, isPayrollC2FrozenDocument, parsePayrollC2Command } from '~/lib/payroll/central-c2-codec'
import { decodePayrollDayworkRead, decodePayrollDayworkResult, encodePayrollDayworkWire } from '~/lib/payroll/central-daywork-codec'
import { transformPayrollC1Wire, transformPayrollC2Wire } from '~/lib/payroll/central-payroll-wire'
import { createCheckedPayrollC2, createPayrollC2ServiceFixture } from '../helpers/payroll-c2-service-fixture'

it('签工C2有限数精确展开十进制定点，null与零保真，科学计数传输不能进入读取或命令', () => {
  for (const unitRate of [null, 0, 350.125, 0.0000001, 1e21, Number.MIN_VALUE, Number.MAX_VALUE, -0.0000001]) {
    const wire = encodePayrollC2Wire({ unitRate })
    expect(wire).toEqual({ unitRate: unitRate === null ? null : expect.stringMatching(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/) })
    expect(transformPayrollC2Wire(wire, true)).toEqual({ unitRate })
  }
  for (const unitRate of ['1e-7', '1E+21', '3.5e2'])
    expect(() => transformPayrollC2Wire({ unitRate }, true)).toThrow()
})

it('同一规范适用于已共享的C1有限费率，原缺值与到分金额不放宽', () => {
  const expected = { overtimeRate: '0.0000001', dailyWage: '1000000000000000000000', hours: '7.51', configuredDailyWage: null, amount: '350.13' }
  const source = { overtimeRate: 0.0000001, dailyWage: 1e21, hours: 7.51, configuredDailyWage: null, amount: 350.13 }
  expect(transformPayrollC1Wire(source, false)).toEqual(expected)
  expect(transformPayrollC1Wire(expected, true)).toEqual(source)
  expect(() => transformPayrollC1Wire({ overtimeRate: '1e-7' }, true)).toThrow()
  expect(() => transformPayrollC1Wire({ amount: '350.125' }, true)).toThrow()
})

it('公开读取拒绝错项目签工和错负责人配置，坏原日期仍保留原文', async () => {
  const f = await createPayrollC2ServiceFixture()
  try {
    await f.daywork()
    const list = await f.ledger()
    const wrongList = structuredClone(list)
    wrongList.records[0]!.projectId = 'other-project'
    expect(() => decodePayrollDayworkRead(encodePayrollDayworkWire(wrongList), 'list', { origin: 'real' }, f.scope)).toThrow()
    await f.service.executeC2(f.c2Command(await f.c2Config(), { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 350.125, ruleText: '' } }))
    const config = await f.c2Config()
    const wrongConfig = structuredClone(config)
    wrongConfig.config!.leaderWorkerId = 'member'
    expect(() => decodePayrollC2Read(encodePayrollC2Wire(wrongConfig), 'config', { origin: 'real' }, config.scope)).toThrow()
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
    expect(() => decodePayrollDayworkResult({ ...result, workerId: 'member' }, command)).toThrow()
    const configCommand = f.c2Command(await f.c2Config(), { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 350.125, ruleText: '' } })
    const configResult = await f.service.executeC2(configCommand)
    expect(() => decodePayrollC2Result({ ...configResult, dayworkRecordIds: [result.recordId], dayworkLinkIds: ['fake-link'] }, configCommand)).toThrow()
    expect(() => parsePayrollC2Command(encodePayrollC2Wire({ ...configCommand, sourceRecordIds: [result.recordId] }))).toThrow()
    expect(() => encodePayrollC2Wire({ actualAmount: 500.001 })).toThrow()
  }
  finally { await f.close() }
})

it('真实释放冻结完整性检验原日期、证明、班组、原行和全成员零分配，不仅核对金额', async () => {
  const f = await createPayrollC2ServiceFixture()
  try {
    const checked = await createCheckedPayrollC2(f)
    await f.service.executeC2(f.c2Command(checked, { kind: 'release-c2', release: { actualAmount: 500, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] } }))
    const read = await f.service.c2Output({ origin: 'real' }, checked.statementId!)
    if (read.state !== 'available')
      throw new Error('真实健康释放必须有冻结')
    expect(isPayrollC2FrozenDocument(read.document)).toBe(true)
    for (const mutate of [
      (copy: typeof read.document) => { copy.daywork[0]!.workDate = '2026-09-01' },
      (copy: typeof read.document) => { copy.daywork[0]!.witness = '' },
      (copy: typeof read.document) => { copy.daywork[0]!.crewId = null },
      (copy: typeof read.document) => { copy.daywork[0]!.original.note = '假原文' },
      (copy: typeof read.document) => { copy.allocations = copy.allocations.filter(a => a.workerId !== 'zero') },
    ]) {
      const copy = structuredClone(read.document)
      mutate(copy)
      expect(isPayrollC2FrozenDocument(copy)).toBe(false)
    }
  }
  finally { await f.close() }
})
