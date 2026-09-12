import type { SupplierCredentialCommand, SupplierCredentialFileContent } from '~/lib/supplier/credential-contract'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { SupplierCredentialNotAppliedProblem } from '~/lib/supplier/credential-contract'
import { createSupplierCredentialRepository, credentialContentBytes } from '~/lib/supplier/credential-repository'
import { credentialRecord, credentialSnapshot } from './credential-ui-fixtures'

const query = { supplierId: 'supplier-a', credentialId: 'credential-a', fileId: 'file-a', origin: 'real' as const }
function original(): SupplierCredentialFileContent {
  const bytes = Buffer.from('%PDF-1.7 synthetic')
  return { ...query, id: 'file-a', ownerType: 'supplier_credential', ownerId: 'credential-a', fileName: '合成证照.pdf', mimeType: 'application/pdf', fileSize: bytes.length, state: 'available', payloadBase64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') }
}
describe('中央证照 Repository', () => {
  it('只有完整且绑定本次识别命令的未应用证明才能释放原提交', async () => {
    const command: SupplierCredentialCommand = { action: 'ocr-recognize', credentialId: 'credential-a', commandId: 'recognize-a', supplierId: 'supplier-a', origin: 'real', workspaceId: 'w', actorId: 'a', requiredCapability: 'supplier-credential:write', baseSupplierVersion: 's1', baseCredentialVersion: 'c1', options: {} }
    const problem = { code: 'unavailable', message: '服务明确识别失败', retryable: true, fieldErrors: {}, traceId: null, commandId: 'recognize-a', commandOutcome: 'not-applied' }
    const repository = createSupplierCredentialRepository(vi.fn().mockRejectedValue({ data: problem }))
    await expect(repository.execute(command)).rejects.toBeInstanceOf(SupplierCredentialNotAppliedProblem)
    for (const patch of [{ commandId: 'another' }, { commandId: undefined }, { retryable: undefined }, { commandOutcome: 'unknown' }]) {
      const invalid = createSupplierCredentialRepository(vi.fn().mockRejectedValue({ data: { ...problem, ...patch } }))
      await expect(invalid.execute(command)).rejects.not.toBeInstanceOf(SupplierCredentialNotAppliedProblem)
    }
  })
  it('识别快照必须绑定同一原件，不能携带另一个主档的核对字段', async () => {
    const recognition = { id: 'recognition-a', fileId: 'another-original', sha256: 'a'.repeat(64), recognizedAt: '2026-09-12T00:00:00Z', result: {}, parsed: { rawText: '', category: { category: '营业执照' as const, confidence: 0.9, evidence: [] }, fields: [], longTerm: false } }
    const value = credentialSnapshot({ credentials: [credentialRecord({ recognition })] })
    await expect(createSupplierCredentialRepository(vi.fn().mockResolvedValue(value)).read('supplier-a', 'real')).rejects.toThrow(/归属/)
  })
  it('正式与演示按当前稳定身份读取，不含本地回退', async () => {
    const fetcher = vi.fn().mockResolvedValue(credentialSnapshot({ dataOrigin: 'demo' }))
    await createSupplierCredentialRepository(fetcher).read('supplier-a', 'demo')
    expect(fetcher).toHaveBeenCalledWith('/api/read/supplier-credentials/supplier-a', { query: { origin: 'demo', includeDemo: true } })
  })
  it.each([
    credentialSnapshot({ supplierId: 'supplier-b' }),
    credentialSnapshot({ dataOrigin: 'demo' }),
    credentialSnapshot({ requirements: [] }),
    credentialSnapshot({ credentials: [credentialRecord({ supplierId: 'supplier-b' })] }),
    credentialSnapshot({ credentials: [credentialRecord({ file: { ...credentialRecord().file!, ownerId: 'other' } })] }),
  ])('拒绝错误身份、缺少要求或串档的响应 %#', async (value) => {
    await expect(createSupplierCredentialRepository(vi.fn().mockResolvedValue(value)).read('supplier-a', 'real')).rejects.toThrow('不完整或归属不匹配')
  })
  it('原件字节、长度、摘要和所有权全部通过才提供内容', async () => {
    const fetcher = vi.fn().mockResolvedValue(original())
    const content = await createSupplierCredentialRepository(fetcher).file(query)
    expect(Buffer.from(credentialContentBytes(content)).toString()).toBe('%PDF-1.7 synthetic')
    expect(fetcher).toHaveBeenCalledWith('/api/read/supplier-credentials/supplier-a/files/file-a', { query: { origin: 'real', credentialId: 'credential-a' } })
  })
  it.each([{ sha256: '0'.repeat(64) }, { fileSize: 1 }, { fileId: 'file-other' }, { origin: 'demo' }, { ownerId: 'credential-b' }])('原件 %j 不一致时拒绝', async (patch) => {
    await expect(createSupplierCredentialRepository(vi.fn().mockResolvedValue({ ...original(), ...patch })).file(query)).rejects.toThrow('不完整或归属不匹配')
  })
  it('保留缺正文与读取无权的不同结果', async () => {
    const missing = { ...original(), state: 'missing', reason: 'missing-payload' }
    const repository = createSupplierCredentialRepository(vi.fn().mockResolvedValue(missing))
    expect((await repository.file(query)).state).toBe('missing')
    const forbidden = createSupplierCredentialRepository(vi.fn().mockRejectedValue({ data: { code: 'forbidden', message: '无权读取原件' } }))
    await expect(forbidden.file(query)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  })
  it('命令回包必须对应本次请求和删除目标', async () => {
    const command: SupplierCredentialCommand = { action: 'delete', credentialId: 'credential-a', commandId: 'command-a', supplierId: 'supplier-a', origin: 'real', workspaceId: 'w', actorId: 'a', requiredCapability: 'supplier-credential:write', baseSupplierVersion: 's1', baseCredentialVersion: 'c1' }
    const repository = createSupplierCredentialRepository(vi.fn().mockResolvedValue({ commandId: 'other', supplierId: 'supplier-a', credentialId: 'credential-a', auditId: null, deletionToken: null, supplierVersion: 's2', credentialVersion: 'c2' }))
    await expect(repository.execute(command)).rejects.toThrow('不完整或归属不匹配')
  })
})
