import type { AuxiliaryContractCommand } from '../../app/lib/auxiliary-contract/contract'
import { describe, expect, it } from 'vitest'
import { createAuxiliaryContractRepository } from '../../app/lib/auxiliary-contract/repository'
import { decodeAuxiliaryCommand } from '../../app/lib/auxiliary-contract/validation'
import { createAuxiliaryContractCommandActions } from '../../app/stores/auxiliary-contract-command'
import { createAuxiliaryContractTestInstance } from '../../server/utils/auxiliary-contract-test-instance'

describe('辅助合同 HTTP Repository', () => {
  it.each([
    { filters: { dataOrigin: 'demo', contractKind: 'company_expense' } },
    { filters: { dataOrigin: 'real', contractKind: 'other_expense' } },
    { subject: { entity: 'project' } },
    { subject: { state: 'forbidden' } },
  ])('拒绝缺失金额契约和串合同的事实响应：%j', async (patch) => {
    const server = createAuxiliaryContractTestInstance({ createId: () => 'decode-330' })
    const session = { workspaceId: 'w', actorId: 'a', capabilities: ['auxiliary-contract:read', 'auxiliary-contract:write'] }
    await server.execute({ ...session, requiredCapability: 'auxiliary-contract:write', commandId: 'create', baseVersion: null, action: 'draft', draft: { kind: 'company_expense', name: '测试' }, attachments: {} }, session)
    const detail = server.detail('decode-330', { kind: 'company_expense' }, session)
    const missingMoney = createAuxiliaryContractRepository(async () => ({ ...detail, contract: { ...detail.contract, amounts: {} } }))
    await expect(missingMoney.detail('decode-330', { kind: 'company_expense' })).rejects.toMatchObject({ problem: { code: 'internal-error' } })
    const foreignFact = createAuxiliaryContractRepository(async () => ({ ...detail, facts: [{ id: 'wrong', contractId: 'different', kind: 'invoice', amount: '1.00', effective: true }] }))
    await expect(foreignFact.detail('decode-330', { kind: 'company_expense' })).rejects.toMatchObject({ problem: { code: 'internal-error' } })
    const navigation = { ...detail.contract.navigation, filters: patch.filters ?? detail.contract.navigation.filters, subject: { ...detail.contract.navigation.subject, ...patch.subject } }
    const invalidNavigation = createAuxiliaryContractRepository(async () => ({ ...detail, contract: { ...detail.contract, navigation } }))
    await expect(invalidNavigation.detail('decode-330', { kind: 'company_expense' })).rejects.toMatchObject({ problem: { code: 'internal-error' } })
  })
  it('通过公开 HTTP 接缝读写同一合同，错误响应保留无权限及可重试语义', async () => {
    const server = createAuxiliaryContractTestInstance({ createId: () => 'http-330' })
    const session = { workspaceId: 'w', actorId: 'a', capabilities: ['auxiliary-contract:read', 'auxiliary-contract:write'] }
    const urls: string[] = []
    const repository = createAuxiliaryContractRepository(async (url, options) => {
      urls.push(url)
      if (options?.method === 'POST')
        return server.execute(decodeAuxiliaryCommand(options.body), session)
      if (url.includes('/context'))
        return server.context(session)
      if (url.includes('/http-330'))
        return server.detail('http-330', options?.query ?? {}, session)
      return server.list(options?.query ?? {}, session)
    })
    const context = await repository.context()
    const saved = await repository.execute({ ...context, requiredCapability: 'auxiliary-contract:write', commandId: 'http-command', baseVersion: null, action: 'draft', draft: { kind: 'company_expense', name: '测试合同' }, attachments: {} })
    expect((await repository.detail(saved.id, { kind: 'company_expense', origin: 'real' })).contract.draft.name).toBe('测试合同')
    expect(urls).toContain('/api/commands/auxiliary-contracts')
    const forbidden = createAuxiliaryContractRepository(async () => {
      throw Object.assign(new Error('无权限'), { data: { data: { code: 'forbidden', message: '无权限', retryable: false, fieldErrors: {}, traceId: null } } })
    })
    await expect(forbidden.list({ kind: 'company_expense' })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    const offline = createAuxiliaryContractRepository(async () => {
      throw new Error('offline')
    })
    await expect(offline.list({ kind: 'other_expense' })).rejects.toMatchObject({ problem: { code: 'unavailable', retryable: true } })
  })
})

function commandFixture() {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => {
    values.set(key, value)
  }, removeItem: (key: string) => {
    values.delete(key)
  } }
  let session = { workspaceId: 'aux-http-workspace', actorId: 'aux-http-owner', capabilities: ['auxiliary-contract:read', 'auxiliary-contract:write'] }
  const owner = createAuxiliaryContractTestInstance({ now: () => '2026-10-07T10:00:00.000Z' })
  const receipts = new Map<string, Awaited<ReturnType<typeof owner.execute>>>()
  let writes = 0
  let resolves = 0
  let readFailures = 0
  let loseResponse = false
  const sent: AuxiliaryContractCommand[] = []
  const repository = createAuxiliaryContractRepository(async (url, options) => {
    if (url.endsWith('/context'))
      return owner.context(session)
    if (url.endsWith('/resolve')) {
      resolves++
      const descriptor = options?.body
      if (!descriptor || typeof descriptor !== 'object' || !('commandId' in descriptor) || typeof descriptor.commandId !== 'string')
        throw new Error('missing original descriptor')
      const result = receipts.get(descriptor.commandId)
      return result ? { outcome: 'applied', result } : { outcome: 'not-applied', commandId: descriptor.commandId }
    }
    if (options?.method === 'POST') {
      writes++
      const request = decodeAuxiliaryCommand(options.body)
      sent.push(request)
      const result = await owner.execute(request, session)
      receipts.set(request.commandId, result)
      if (loseResponse)
        throw new Error('response lost after actual save')
      return result
    }
    if (readFailures > 0) {
      readFailures--
      throw new Error('saved target GET failed')
    }
    return owner.detail(decodeURIComponent(url.split('/').at(-1)!), options?.query ?? {}, session)
  })
  return { repository, storage, values, sent, receipt: (id: string) => receipts.get(id), actions: () => createAuxiliaryContractCommandActions('company_expense', () => repository, () => storage), counts: () => ({ writes, resolves }), failRead: () => {
    readFailures++
  }, loseResponse: () => {
    loseResponse = true
  }, setSession: (next: typeof session) => {
    session = next
  }, session: () => session }
}
describe('辅助合同原表单最小恢复', () => {
  const input = { kind: 'company_expense' as const, name: '实际公司合同', amount: 0 }
  it('保存成功但GET失败时保原编号、禁止新POST，核对仅重试同一目标读取', async () => {
    const f = commandFixture()
    const actions = f.actions()
    const session = actions.createSession()
    await actions.hydrate(session, null)
    f.failRead()
    await expect(actions.saveForm(session, input, 'draft')).rejects.toThrow(/已保存待刷新/)
    expect(session.pending?.result?.id).toBeTruthy()
    expect(f.counts()).toEqual({ writes: 1, resolves: 0 })
    const persisted = JSON.parse([...f.values.values()][0]!)
    expect(Object.keys(persisted).sort()).toEqual(['action', 'actorId', 'commandId', 'family', 'scopeId', 'targetId', 'workspaceId'])
    expect(persisted.scopeId).toBe('company_expense')
    expect(JSON.stringify(persisted)).not.toContain(input.name)
    await expect(actions.saveForm(session, { ...input, name: '后来输入' }, 'draft')).rejects.toThrow(/只核对原提交/)
    const recovered = await actions.recover(session)
    expect(recovered?.outcome).toBe('applied')
    expect(recovered?.form?.draft.name).toBe(input.name)
    expect(f.counts()).toEqual({ writes: 1, resolves: 0 })
    expect(f.values.size).toBe(0)
  })
  it('响应丢失后重建页面仅凭最小descriptor查同原号，读取实际已保存目标且不重复发送正文', async () => {
    const f = commandFixture()
    const old = f.actions()
    const session = old.createSession()
    await old.hydrate(session, null)
    f.loseResponse()
    await expect(old.saveForm(session, input, 'draft')).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    const commandId = f.sent[0]!.commandId
    const fresh = f.actions()
    const restored = await fresh.hydrate(fresh.createSession(), null)
    expect(restored.recoveryOutcome).toBe('applied')
    expect(restored.form?.draft.name).toBe(input.name)
    expect(f.counts()).toEqual({ writes: 1, resolves: 1 })
    expect(restored.form?.draft.id).toBe(f.receipt(commandId)?.id)
    expect(commandId).toBe(f.sent[0]!.commandId)
    expect(f.values.size).toBe(0)
  })
  it('身份或权限变化阻断新写入与原号核对，最小定位和当前输入留在原页面', async () => {
    const f = commandFixture()
    const actions = f.actions()
    const session = actions.createSession()
    await actions.hydrate(session, null)
    const original = f.session()
    f.setSession({ ...original, actorId: 'another-aux-owner' })
    await expect(actions.saveForm(session, input, 'draft')).rejects.toMatchObject({ problem: { code: 'unavailable', message: '合同服务暂时不可用，请重试' } })
    expect(f.counts().writes).toBe(0)
    expect(f.values.size).toBe(1)
    await expect(actions.recover(session)).rejects.toThrow(/身份或权限/)
    expect(f.counts().resolves).toBe(0)
  })
})
