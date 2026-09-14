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

it.each(['ordinary', 'ordinary-unknown', 'management'] as const)('%s 真实费用工资发放后，以合法只读冻结输出完成原提交核对', async (scenario) => {
  const f = await createPayrollAFeesFixture()
  try {
    let statementId: string
    const actualAmount = scenario === 'management' ? 100 : 3815
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
      setActivePinia(createPinia())
      store = usePayrollAStore()
      await store.recoverA(store.getAPending(before)!)
      expect(commands).toEqual([original.command.commandId, original.command.commandId])
    }
    else {
      await release
    }
    const original = store.getAPending(before)!
    const refreshed = await store.loadAForm({ origin: 'real' }, { statementId })
    const output = await store.loadAOutput({ origin: 'real' }, statementId)
    expect(refreshed).toMatchObject({ status: 'released', context: { readonly: false } })
    expect(output).toMatchObject({ state: 'available', context: { readonly: true }, document: { actualAmount } })
    expect(() => store.acknowledgeA(original, before, output)).toThrow()
    expect(() => store.acknowledgeA(original, refreshed, structuredClone(output))).toThrow()

    if (scenario === 'ordinary' && output.state === 'available') {
      const invalidOutputs: PayrollAOutputRead[] = [
        { ...output, context: { ...output.context, actorId: 'other' } },
        { ...output, context: { ...output.context, workspaceId: 'other' } },
        { ...output, context: { ...output.context, origin: 'demo' } },
        { ...output, context: { ...output.context, capabilities: ['payroll:read'] } },
        { ...output, statementId: 'other' },
        { ...output, document: { ...output.document, id: 'other' } },
        { ...output, document: { ...output.document, projectId: 'other' } },
        { ...output, state: 'unavailable', document: null, reasons: ['原件不可用'] },
      ]
      for (const invalid of invalidOutputs) {
        const mock = vi.spyOn(repository, 'aOutput').mockResolvedValueOnce(invalid)
        const read = await store.loadAOutput({ origin: 'real' }, statementId)
        expect(() => store.acknowledgeA(original, refreshed, read)).toThrow()
        expect(store.getAPending(before)?.state).toBe('awaiting-read')
        mock.mockRestore()
      }
    }
    store.acknowledgeA(original, refreshed, output)
    expect(store.getAPending(before)).toBeNull()
    expect(await f.db.select('SELECT id FROM wage_statements WHERE status=\'released\'')).toHaveLength(1)
  }
  finally { await f.close() }
})
