import type { PayrollHollowCommand } from '../../app/lib/payroll/central-hollow-deduction-contract'
import { describe, expect, it } from 'vitest'
import { decodePayrollHollowResult, encodePayrollHollowWire, parsePayrollHollowCommand } from '../../app/lib/payroll/central-hollow-deduction-codec'

function configCommand(unitAmount: number | null = 30): PayrollHollowCommand {
  return {
    commandId: 'hollow-config-1',
    workspaceId: 'workspace-1',
    actorId: 'actor-1',
    origin: 'real',
    requiredCapability: 'payroll:write',
    sourceVersion: 'payroll:hollow:v1',
    projectId: 'project-1',
    target: null,
    config: { month: '2026-08', scope: { projectId: 'project-1', crewId: null, leaderWorkerId: 'worker-1', formatFamily: 'A', book: { bookPurpose: 'ordinary', managementBookId: null } } },
    action: { kind: 'save-hollow-policies', policies: [{ policyId: null, baseRevisionId: null, itemId: 'item-1', enabled: true, unitAmount, effectiveMonth: '2026-08' }] },
  }
}
function startCommand(): PayrollHollowCommand {
  return { ...configCommand(), commandId: 'hollow-start-1', target: { statementId: 'wage-1', draftKey: null }, config: null, action: { kind: 'start-hollow-deduction' } }
}

describe('空鼓工资提交的封闭边界', () => {
  it('单处价格保留0、明确空及原精度，不接受指数wire或数值wire', () => {
    for (const amount of [0, null, 0.00000001, 30]) {
      const command = configCommand(amount)
      expect(parsePayrollHollowCommand(encodePayrollHollowWire(command))).toEqual(command)
    }
    const wire = encodePayrollHollowWire(configCommand()) as { action: { policies: Array<{ unitAmount: unknown }> } }
    wire.action.policies[0]!.unitAmount = '3e1'
    expect(() => parsePayrollHollowCommand(wire)).toThrow()
    wire.action.policies[0]!.unitAmount = 30
    expect(() => parsePayrollHollowCommand(wire)).toThrow()
  })

  it('明确关闭保留false，missing不等于false或默认价', () => {
    const command = configCommand(null)
    if (command.action.kind !== 'save-hollow-policies')
      throw new Error('fixture')
    command.action.policies[0]!.enabled = false
    expect(parsePayrollHollowCommand(encodePayrollHollowWire(command))).toEqual(command)
    const wire = encodePayrollHollowWire(command) as { action: { policies: Array<Record<string, unknown>> } }
    delete wire.action.policies[0]!.enabled
    expect(() => parsePayrollHollowCommand(wire)).toThrow()
    wire.action.policies[0]!.enabled = false
    delete wire.action.policies[0]!.unitAmount
    expect(() => parsePayrollHollowCommand(wire)).toThrow()
  })

  it('只对已保存原单启动，不接客户端总额、处数或自由来源', () => {
    const command = startCommand()
    expect(parsePayrollHollowCommand(encodePayrollHollowWire(command))).toEqual(command)
    for (const extra of [{ amount: '450.00' }, { count: 15 }, { recordIds: ['record-1'] }])
      expect(() => parsePayrollHollowCommand({ ...command, action: { ...command.action, ...extra } })).toThrow()
    expect(() => parsePayrollHollowCommand({ ...command, target: { statementId: null, draftKey: 'unsaved-1' } })).toThrow()
    expect(() => parsePayrollHollowCommand({ ...command, target: { statementId: 'wage-1' } })).toThrow()
  })

  it('配置原项目、原价格前序及格式用途不能串用', () => {
    const command = configCommand()
    expect(() => parsePayrollHollowCommand(encodePayrollHollowWire({ ...command, projectId: 'another-project' }))).toThrow()
    expect(() => parsePayrollHollowCommand(encodePayrollHollowWire({ ...command, config: { ...command.config, scope: { ...command.config!.scope, formatFamily: 'C1' } } }))).toThrow()
    if (command.action.kind !== 'save-hollow-policies')
      throw new Error('fixture')
    command.action.policies[0]!.policyId = 'policy-1'
    expect(() => parsePayrollHollowCommand(encodePayrollHollowWire(command))).toThrow()
    command.action.policies[0]!.baseRevisionId = 'revision-1'
    command.action.policies.push({ ...command.action.policies[0]! })
    expect(() => parsePayrollHollowCommand(encodePayrollHollowWire(command))).toThrow()
  })

  it('启动回执必须绑定原单、准确启动记录与日志集合', () => {
    const command = startCommand()
    const receipt = { commandId: command.commandId, projectId: command.projectId, statementId: 'wage-1', startId: 'start-1', policyRevisionIds: [], sourceVersion: 'payroll:hollow:v2', outcome: 'started', logIds: ['log-1'] }
    expect(decodePayrollHollowResult(receipt, command).startId).toBe('start-1')
    for (const invalid of [{ statementId: 'wage-2' }, { startId: null }, { policyRevisionIds: ['policy-2'] }, { logIds: ['log-1', 'log-1'] }, { amount: 450 }])
      expect(() => decodePayrollHollowResult({ ...receipt, ...invalid }, command)).toThrow()
  })
})
