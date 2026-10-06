import { describe, expect, it, vi } from 'vitest'
import { createHttpConstructionContractReadRepository } from '../../app/lib/construction-contract/http-repository'
import { createHttpSubcontractContractReadRepository } from '../../app/lib/subcontract-contract/http-repository'

const original = {
  ownerId: 'contract-a',
  fileId: 'file-a',
  dataOrigin: 'real',
  fileName: 'a.txt',
  mimeType: 'text/plain',
  fileSize: 1,
  payloadBase64: 'YQ==',
  sha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
}

describe.each([
  ['施工', '/api/read/construction-contracts', createHttpConstructionContractReadRepository],
  ['分包', '/api/read/subcontract-contracts', createHttpSubcontractContractReadRepository],
] as const)('%s合同原件读取契约', (_label, base, create) => {
  it('请求固定归属和来源并透传取消信号，正文长度、校验码独立核实', async () => {
    const fetcher = vi.fn().mockResolvedValue(original)
    const repository = create({ fetcher })
    const signal = new AbortController().signal
    await expect(repository.fileContent('contract-a', 'file-a', 'real', { signal })).resolves.toEqual(original)
    expect(fetcher).toHaveBeenCalledWith(`${base}/contract-a/files/file-a`, { query: { origin: 'real' }, signal })
    for (const change of [
      { ownerId: 'another-contract' },
      { fileId: 'another-file' },
      { dataOrigin: 'demo' },
      { fileSize: 0 },
      { fileSize: 1.5 },
      { sha256: '0'.repeat(64) },
      { payloadBase64: 'YQ' },
      { payloadBase64: 'YR==' },
      { payloadBase64: 'Yg==' },
    ]) {
      fetcher.mockResolvedValue({ ...original, ...change })
      await expect(repository.fileContent('contract-a', 'file-a', 'real')).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    }
  })
  it('真实零字节仍有正文和空文件校验码，缺正文与演示来源均拒绝', async () => {
    const empty = { ...original, fileSize: 0, payloadBase64: '', sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }
    const fetcher = vi.fn().mockResolvedValue(empty)
    const repository = create({ fetcher })
    await expect(repository.fileContent('contract-a', 'file-a', 'real')).resolves.toEqual(empty)
    fetcher.mockResolvedValue({ ...empty, payloadBase64: undefined })
    await expect(repository.fileContent('contract-a', 'file-a', 'real')).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    fetcher.mockResolvedValue(original)
    await expect(repository.fileContent('contract-a', 'file-a', 'demo')).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  })
})
