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
  function createInvalidPolicyPriceWire() {
    const wire = encodePayrollHollowWire(configCommand()) as { action: { policies: Array<{ unitAmount: unknown }> } }
    wire.action.policies[0]!.unitAmount = '3e1'
    return { wire }
  }

  it.each([
    { case: 'wire', prepare: ({ wire }: ReturnType<typeof createInvalidPolicyPriceWire>) => {
      return { input: wire } as const
    } },
    { case: 'wire', prepare: ({ wire }: ReturnType<typeof createInvalidPolicyPriceWire>) => {
      wire.action.policies[0]!.unitAmount = 30
      return { input: wire } as const
    } },
  ])('单处价格保留0、明确空及原精度，不接受指数wire或数值wire / parsePayrollHollowCommand：$case', ({ prepare }) => {
    const fixture = createInvalidPolicyPriceWire()
    const { input } = prepare(fixture)
    expect(() => parsePayrollHollowCommand(input)).toThrow('空鼓扣款金额或单处价格的传输格式无效')
  })

  it.each(Array.from([0, null, 0.00000001, 30]).map(input => ({ input })))('单处价格保留0、明确空及原精度，不接受指数wire或数值wire：输入组合 1 案例 %#', ({ input: amount }) => {
    const command = configCommand(amount)
    expect(parsePayrollHollowCommand(encodePayrollHollowWire(command))).toEqual(command)
  })

  function createDisabledPolicyWire() {
    const command = configCommand(null)
    if (command.action.kind !== 'save-hollow-policies')
      throw new Error('fixture')
    command.action.policies[0]!.enabled = false
    const wire = encodePayrollHollowWire(command) as { action: { policies: Array<Record<string, unknown>> } }
    delete wire.action.policies[0]!.enabled
    return { command, wire }
  }

  it('明确关闭保留 false 和明确空单处价格', () => {
    const { command } = createDisabledPolicyWire()
    expect(parsePayrollHollowCommand(encodePayrollHollowWire(command))).toEqual(command)
  })

  it.each([
    { case: 'wire', prepare: ({ wire }: ReturnType<typeof createDisabledPolicyWire>) => {
      return { input: wire } as const
    } },
    { case: 'wire', prepare: ({ wire }: ReturnType<typeof createDisabledPolicyWire>) => {
      wire.action.policies[0]!.enabled = false
      delete wire.action.policies[0]!.unitAmount
      return { input: wire } as const
    } },
  ])('明确关闭保留false，missing不等于false或默认价 / parsePayrollHollowCommand：$case', ({ prepare }) => {
    const fixture = createDisabledPolicyWire()
    const { input } = prepare(fixture)
    expect(() => parsePayrollHollowCommand(input)).toThrow('扣款配置须绑定原请款主体和项目，分项不可重复')
  })

  describe('只对已保存原单启动，不接客户端总额、处数或自由来源', () => {
    const command = startCommand()
    it('关联事实保持原契约', () => {
      expect(parsePayrollHollowCommand(encodePayrollHollowWire(command))).toEqual(command)
    })

    it.each([
      { case: '{ ...command, target: { statementId: null, draftKey: \'unsaved-1\' } }', input: { ...command, target: { statementId: null, draftKey: 'unsaved-1' } } },
      { case: '{ ...command, target: { statementId: \'wage-1\' } }', input: { ...command, target: { statementId: 'wage-1' } } },
    ])('parsePayrollHollowCommand：$case', ({ input }) => {
      expect(() => parsePayrollHollowCommand(structuredClone(input))).toThrow('请先保存工资草稿，再对这张单明确开始扣款')
    })
  })

  it.each(Array.from([{ amount: '450.00' }, { count: 15 }, { recordIds: ['record-1'] }]).map(input => ({ input })))('只对已保存原单启动，不接客户端总额、处数或自由来源：输入组合 1 案例 %#', ({ input: extra }) => {
    const command = startCommand()
    expect(parsePayrollHollowCommand(encodePayrollHollowWire(command))).toEqual(command)
    expect(() => parsePayrollHollowCommand({ ...command, action: { ...command.action, ...extra } })).toThrow('空鼓扣款资料不完整或包含不支持的内容')
  })

  function createPolicyScopeCommand() {
    const command = configCommand()
    return { command }
  }

  it.each([
    { case: 'encodePayrollHollowWire({ ...command, projectId: \'another-project\' })', prepare: ({ command }: ReturnType<typeof createPolicyScopeCommand>) => {
      return { input: encodePayrollHollowWire({ ...command, projectId: 'another-project' }) } as const
    } },
    { case: 'encodePayrollHollowWire({ ...command, config: { ...command.config, scope: { ...command.config!.scope, formatFa', prepare: ({ command }: ReturnType<typeof createPolicyScopeCommand>) => {
      return { input: encodePayrollHollowWire({ ...command, config: { ...command.config, scope: { ...command.config!.scope, formatFamily: 'C1' } } }) } as const
    } },
    { case: 'encodePayrollHollowWire(command)', prepare: ({ command }: ReturnType<typeof createPolicyScopeCommand>) => {
      if (command.action.kind !== 'save-hollow-policies')
        throw new Error('fixture')
      command.action.policies[0]!.policyId = 'policy-1'
      return { input: encodePayrollHollowWire(command) } as const
    } },
    { case: 'encodePayrollHollowWire(command)', prepare: ({ command }: ReturnType<typeof createPolicyScopeCommand>) => {
      if (command.action.kind !== 'save-hollow-policies')
        throw new Error('fixture')
      command.action.policies[0]!.policyId = 'policy-1'
      command.action.policies[0]!.baseRevisionId = 'revision-1'
      command.action.policies.push({ ...command.action.policies[0]! })
      return { input: encodePayrollHollowWire(command) } as const
    } },
  ])('配置原项目、原价格前序及格式用途不能串用 / parsePayrollHollowCommand：$case', ({ prepare }) => {
    const fixture = createPolicyScopeCommand()
    const { input } = prepare(fixture)
    expect(() => parsePayrollHollowCommand(input)).toThrow('扣款配置须绑定原请款主体和项目，分项不可重复')
  })

  it.each([
    { label: '错配原单', invalid: { statementId: 'wage-2' }, reason: '扣款启动回执缺少原单或准确启动记录' },
    { label: '缺启动记录', invalid: { startId: null }, reason: '扣款启动回执缺少原单或准确启动记录' },
    { label: '多出配置修订', invalid: { policyRevisionIds: ['policy-2'] }, reason: '扣款启动回执缺少原单或准确启动记录' },
    { label: '日志重复', invalid: { logIds: ['log-1', 'log-1'] }, reason: '扣款提交回执与原命令不匹配' },
    { label: '夹带金额字段', invalid: { amount: 450 }, reason: '空鼓扣款资料不完整或包含不支持的内容' },
  ])('启动回执必须绑定原单、准确启动记录与日志集合：拒绝$label', ({ invalid, reason }) => {
    const command = startCommand()
    const receipt = { commandId: command.commandId, projectId: command.projectId, statementId: 'wage-1', startId: 'start-1', policyRevisionIds: [], sourceVersion: 'payroll:hollow:v2', outcome: 'started', logIds: ['log-1'] }
    expect(decodePayrollHollowResult(receipt, command).startId).toBe('start-1')
    expect(() => decodePayrollHollowResult({ ...receipt, ...invalid }, command)).toThrow(reason)
  })
})
