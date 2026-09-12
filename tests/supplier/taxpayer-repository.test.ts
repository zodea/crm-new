import type { SupplierTaxpayerCommand, SupplierTaxpayerResult } from '~/lib/supplier/taxpayer-verification'
import { describe, expect, it, vi } from 'vitest'
import { createHttpSupplierCommandRepository } from '~/lib/supplier/command-http-repository'
import { verifiedTaxpayerFields } from '~/lib/supplier/taxpayer-verification'

const command: SupplierTaxpayerCommand = { supplierId: 'supplier/a', origin: 'real', workspaceId: 'workspace', actorId: 'actor', requiredCapability: 'supplier:write', commandId: 'command', baseSupplierVersion: '1', expectedTaxNo: 'TAX-A', draft: { status: 'not_found', taxpayerType: '小规模纳税人', note: '人工输入' } }
const result: SupplierTaxpayerResult = { supplierId: command.supplierId, commandId: command.commandId, supplierVersion: '2', credentialVersion: '1', credentialId: null, auditId: 'audit', deletionToken: null, verification: verifiedTaxpayerFields(command.draft, '2026-09-12T12:00:00.000Z') }
describe('税务核验 HTTP 回包', () => {
  it('中央请求编码稳定主体，只有本次结果和凭证通过后才返回', async () => {
    const fetcher = vi.fn().mockResolvedValue(result)
    const repository = createHttpSupplierCommandRepository({ fetcher })
    expect(await repository.recordTaxpayerVerification(command)).toEqual(result)
    expect(fetcher).toHaveBeenCalledWith('/api/commands/suppliers/supplier%2Fa/taxpayer-verification', { method: 'POST', body: command })
  })
  it.each([{ supplierId: 'another' }, { commandId: 'another' }, { verification: { ...result.verification, taxpayerType: '小规模纳税人' } }, { verification: { ...result.verification, taxpayerVerifiedAt: 'fake' } }])('拒绝错主体、错提交或矛盾结果 %j', async (patch) => {
    const repository = createHttpSupplierCommandRepository({ fetcher: async () => ({ ...result, ...patch }) })
    await expect(repository.recordTaxpayerVerification(command)).rejects.toThrow()
  })
})
