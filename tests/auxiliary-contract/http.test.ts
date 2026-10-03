import { describe, expect, it } from 'vitest'
import { createAuxiliaryContractRepository } from '../../app/lib/auxiliary-contract/repository'
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
        return server.execute(options.body, session)
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
