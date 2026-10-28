import { expect, it } from 'vitest'
import { decodePayrollARead, decodePayrollAResult, encodePayrollAWire, parsePayrollACommand } from '~/lib/payroll/central-a-codec'
import { createPayrollAServiceFixture } from '../helpers/payroll-a-service-fixture'

it('工资预览拒绝缺数量/状态权限不符/错目标，金额不能传输时取整成另一笔', async () => {
  const f = await createPayrollAServiceFixture()
  try {
    const read = await f.form()
    const input = { statementId: null, draftKey: 'new-a', draft: f.draft } as const
    const wire = encodePayrollAWire(read) as Record<string, unknown>
    expect(() => decodePayrollARead(wire, 'form', { origin: 'real' }, { ...input, draftKey: 'another-draft' })).toThrow('工资核算数据不完整')
    expect(() => decodePayrollARead({ ...wire, context: { ...read.context, readonly: true } }, 'form', { origin: 'real' }, input)).toThrow('工资读取权限与可写状态不一致')
    const missing = JSON.parse(JSON.stringify(wire))
    delete missing.facts[0].fieldQty
    expect(() => decodePayrollARead(missing, 'form', { origin: 'real' }, input)).toThrow('工资核算数据不完整')
    expect(() => encodePayrollAWire({ actualAmount: 0.291 })).toThrow('精确到分')
    expect(encodePayrollAWire({ actualAmount: 0.29, fieldQty: 1.234567 })).toEqual({ actualAmount: '0.29', fieldQty: '1.234567' })
    const command = f.command(read, { kind: 'save-a-draft', draft: f.draft })
    expect(parsePayrollACommand(encodePayrollAWire(command))).toEqual(command)
    expect(() => parsePayrollACommand({ ...encodePayrollAWire(command) as Record<string, unknown>, extraSource: [] })).toThrow('工资请求包含不支持的字段')
    expect(() => decodePayrollAResult({ commandId: command.commandId, projectId: 'p', statementId: 'created', subjectConfigId: null, priceRevisionIds: [], sourceVersion: 'next', logIds: [], outcome: 'released' }, command)).toThrow('原动作')
  }
  finally { await f.close() }
})
