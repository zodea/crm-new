import type { SupplierCredentialCommand } from '~/lib/supplier/credential-contract'
import { describe, expect, it } from 'vitest'
import { parseSupplierCredentialCommand, supplierCredentialOrigin } from '../../server/utils/supplier-credential-request'

const command: SupplierCredentialCommand = { action: 'review', commandId: 'manual-review-1', supplierId: 'supplier-1', origin: 'real', workspaceId: 'workspace', actorId: 'actor', requiredCapability: 'supplier-credential:write', baseSupplierVersion: '3', baseCredentialVersion: '2', draft: { decision: 'qualified', note: '人工核对' } }
describe('证照 HTTP 请求边界', () => {
  it('明确携带主档及证照双版本，不接受人工凭证注入', () => {
    expect(parseSupplierCredentialCommand(command)).toEqual(command)
    expect(() => parseSupplierCredentialCommand({ ...command, reviewedAt: '2000-01-01' })).toThrow()
    expect(() => parseSupplierCredentialCommand({ ...command, draft: { ...command.draft, actorId: 'forged' } })).toThrow()
    expect(() => parseSupplierCredentialCommand({ ...command, baseSupplierVersion: null })).toThrow()
  })
  it.each(['upload', 'edit', 'requirement', 'review', 'delete', 'restore'])('拒绝 %s 动作缺失其必要字段', (action) => {
    expect(() => parseSupplierCredentialCommand({ ...command, action, draft: {} })).toThrow()
  })
  it.each([undefined, null, ['real'], ['demo'], 'local', 'REAL'])('拒绝不明确读取来源 %j', (origin) => {
    expect(() => supplierCredentialOrigin({ origin })).toThrow()
  })
  it('演示必须显式启用，文件查询只允许追加明确证照身份', () => {
    expect(supplierCredentialOrigin({ origin: 'real' })).toBe('real')
    expect(() => supplierCredentialOrigin({ origin: 'demo' })).toThrow()
    expect(supplierCredentialOrigin({ origin: 'demo', includeDemo: 'true' })).toBe('demo')
    expect(() => supplierCredentialOrigin({ origin: 'real', credentialId: 'credential-1' })).toThrow()
    expect(supplierCredentialOrigin({ origin: 'real', credentialId: 'credential-1' }, ['credentialId'])).toBe('real')
    expect(() => supplierCredentialOrigin({ origin: 'demo', includeDemo: ['true'] })).toThrow()
  })
})
