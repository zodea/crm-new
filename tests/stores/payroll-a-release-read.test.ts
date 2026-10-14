// @vitest-environment jsdom
import type { PayrollAFormInput, PayrollAOutputRead } from '~/lib/payroll/central-a-contract'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { encodePayrollAWire, parsePayrollACommand } from '~/lib/payroll/central-a-codec'
import { createPayrollRepository } from '~/lib/payroll/central-repository'
import { usePayrollAStore } from '~/stores/payroll-a'
import { createPayrollAFeesFixture } from '../helpers/payroll-a-fees-fixture'

beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
})
afterEach(() => vi.unstubAllGlobals())

type AvailableOutput = Extract<PayrollAOutputRead, { state: 'available' }>
const corruptedOutputs = [
  (output: AvailableOutput): PayrollAOutputRead => ({ ...output, context: { ...output.context, actorId: 'other' } }),
  (output: AvailableOutput): PayrollAOutputRead => ({ ...output, context: { ...output.context, workspaceId: 'other' } }),
  (output: AvailableOutput): PayrollAOutputRead => ({ ...output, context: { ...output.context, origin: 'demo' } }),
  (output: AvailableOutput): PayrollAOutputRead => ({ ...output, context: { ...output.context, capabilities: ['payroll:read'] } }),
  (output: AvailableOutput): PayrollAOutputRead => ({ ...output, statementId: 'other' }),
  (output: AvailableOutput): PayrollAOutputRead => ({ ...output, document: { ...output.document, id: 'other' } }),
  (output: AvailableOutput): PayrollAOutputRead => ({ ...output, document: { ...output.document, projectId: 'other' } }),
  (output: AvailableOutput): PayrollAOutputRead => ({ ...output, state: 'unavailable', document: null, reasons: ['原件不可用'] }),
]

it.each([
  ...corruptedOutputs.map(corrupt => ({ scenario: 'ordinary' as const, actualAmount: 3815, corrupt })),
  { scenario: 'ordinary-unknown' as const, actualAmount: 3815, corrupt: null },
  { scenario: 'management' as const, actualAmount: 100, corrupt: null },
])('$scenario 工资实发 $actualAmount 后以授权原件核对提交：%#', async ({ scenario, actualAmount, corrupt }) => {
  // 条件：普通簿应付3815（含215补贴）或管理簿实付100；动作：提交，失响应时换Pinia实例恢复原命令。
  // 结果：原工资、分配、来源、版本、日志和回执只提交一次，授权原件冷读后才解除待核对。
  // 防止响应丢失被误判成未付款、恢复时重写已发原件，或错误来源的读取解除原提交保护。
  const f = await createPayrollAFeesFixture()
  try {
    let statementId: string
    if (scenario === 'management') {
      statementId = (await (await f.management()).start()).statementId!
    }
    else {
      await f.prices()
      await f.saveFees([
        f.fee({ basis: { kind: 'completed-field-quantity', itemIds: ['wall', 'floor'], scope: { kind: 'project' } } }),
        f.fee({ kind: 'subsidy', name: '独立补贴', unitPrice: 0.2 }),
      ])
      const draft = { ...f.draft, book: f.ordinary, payRatio: 1 }
      const form = await f.form(draft)
      statementId = (await f.service.execute(f.command(form, { kind: 'save-a-draft', draft }))).statementId!
    }
    await f.service.execute(f.command(await f.service.aForm({ origin: 'real' }, { statementId }), { kind: 'check-a' }))
    let loseResponse = scenario === 'ordinary-unknown'
    const commands: string[] = []
    // 使用公开服务的真实响应，经原 wire/Repository 解码；不伪造 output.readonly。
    const repository = createPayrollRepository(async (url, options) => {
      if (url === '/api/read/payroll/a-form')
        return encodePayrollAWire(await f.service.aForm({ origin: 'real' }, options!.body!.input as PayrollAFormInput))
      if (url === '/api/read/payroll/a-output')
        return encodePayrollAWire(await f.service.aOutput({ origin: 'real' }, String(options!.query!.statementId)))
      if (url === '/api/commands/payroll-a') {
        const command = parsePayrollACommand(options!.body)
        commands.push(command.commandId)
        const result = await f.service.execute(command)
        if (loseResponse) {
          loseResponse = false
          throw new Error('原发放响应丢失')
        }
        return encodePayrollAWire(result)
      }
      throw new Error(`未预期读取 ${url}`)
    })
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: repository } }))
    let store = usePayrollAStore()
    const before = await store.loadAForm({ origin: 'real' }, { statementId })
    const release = store.releaseA(before, { actualAmount, allocations: before.members.map(m => ({ workerId: m.id, amount: m.id === before.draft.leaderWorkerId ? actualAmount : 0 })) })
    if (scenario === 'ordinary-unknown') {
      await expect(release).rejects.toThrow('服务暂时不可用')
      const original = store.getAPending(before)!
      const tables = ['wage_statements', 'wage_statement_allocations', 'payroll_a_statement_sources', 'payroll_command_receipts', 'payroll_revision', 'operation_logs']
      const persisted = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table, await f.db.select(`SELECT * FROM ${table} ORDER BY rowid`)])))
      const committedBeforeRecovery = await persisted()
      expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(3815)
      setActivePinia(createPinia())
      store = usePayrollAStore()
      await store.recoverA(store.getAPending(before)!)
      expect(commands).toEqual([original.command.commandId, original.command.commandId])
      expect(await persisted()).toEqual(committedBeforeRecovery)
    }
    else {
      await release
    }
    const original = store.getAPending(before)!
    const refreshed = await store.loadAForm({ origin: 'real' }, { statementId })
    const output = await store.loadAOutput({ origin: 'real' }, statementId)
    expect(refreshed).toMatchObject({ status: 'released', context: { readonly: false } })
    expect(output).toMatchObject({ state: 'available', context: { readonly: true }, document: { actualAmount } })
    expect(() => store.acknowledgeA(original, before, output)).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
    expect(() => store.acknowledgeA(original, refreshed, structuredClone(output))).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')

    if (corrupt && output.state === 'available') {
      const invalid = corrupt(output)

      const mock = vi.spyOn(repository, 'aOutput').mockResolvedValueOnce(invalid)
      const read = await store.loadAOutput({ origin: 'real' }, statementId)
      expect(() => store.acknowledgeA(original, refreshed, read)).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
      expect(store.getAPending(before)?.state).toBe('awaiting-read')
      mock.mockRestore()
    }
    store.acknowledgeA(original, refreshed, output)
    expect(store.getAPending(before)).toBeNull()
    expect(await f.db.select('SELECT id,actual_amount FROM wage_statements WHERE status=\'released\'')).toEqual([{ id: statementId, actual_amount: actualAmount }])
    expect(await f.db.select('SELECT worker_id,allocated_amount_fen FROM wage_statement_allocations WHERE statement_id=? AND deleted_at IS NULL ORDER BY worker_id', [statementId])).toEqual(scenario === 'management'
      ? [{ worker_id: 'w', allocated_amount_fen: 10000 }]
      : [{ worker_id: 'w', allocated_amount_fen: 381500 }, { worker_id: 'zero', allocated_amount_fen: 0 }])
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(actualAmount)
  }
  finally { await f.close() }
})
