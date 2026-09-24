import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decodeProjectSupplierFileContent } from '~/lib/project-supplier/file-content'

const query = {
  projectId: 'project-438',
  supplierId: 'supplier-438',
  relationId: 'relation-438',
  fileId: 'file-438',
  ownerType: 'project_supplier',
  ownerId: 'relation-438',
  origin: 'real' as const,
  includeDemo: false,
}

function response() {
  const bytes = Buffer.from('中央原件：保留原始字节\n')
  return {
    state: 'available',
    ...query,
    dataOrigin: query.origin,
    fileName: '合作说明.txt',
    mimeType: 'text/plain',
    fileSize: bytes.byteLength,
    sourceVersion: 'central-files:1',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    payloadBase64: bytes.toString('base64'),
  }
}

describe('项目合作档案正文读取边界', () => {
  it('按同一中央身份解码并验证原始字节，返回可供预览下载的正文', async () => {
    const result = await decodeProjectSupplierFileContent(response(), query)
    expect(result.state).toBe('available')
    if (result.state !== 'available')
      throw new Error('原件未返回')
    expect(new TextDecoder().decode(result.bytes)).toBe('中央原件：保留原始字节\n')
    expect(result.fileName).toBe('合作说明.txt')
    expect(result.sha256).toBe(response().sha256)
    expect(result).not.toHaveProperty('payloadBase64')
  })

  it('其他 owner 即使回传同身份与有效摘要，也不得冒称已接入合作原件', async () => {
    const otherOwner = { ...query, ownerType: 'invoice', ownerId: 'invoice-438' }
    await expect(decodeProjectSupplierFileContent({ ...response(), ...otherOwner }, otherOwner))
      .rejects
      .toMatchObject({ problem: { code: 'unavailable' } })
  })

  it.each(['projectId', 'supplierId', 'relationId', 'fileId', 'ownerType', 'ownerId', 'dataOrigin'])(
    '拒绝正文响应中的错配 %s，不根据名称或文件 ID 猜来源',
    async (key) => {
      await expect(decodeProjectSupplierFileContent({ ...response(), [key]: 'other' }, query))
        .rejects
        .toMatchObject({ problem: { code: 'unavailable' } })
    },
  )

  it.each([
    { fileSize: 1 },
    { payloadBase64: 'not base64' },
    { sha256: '0'.repeat(64) },
  ])('拒绝被破坏的正文、长度或摘要：%j', async (change) => {
    await expect(decodeProjectSupplierFileContent({ ...response(), ...change }, query))
      .rejects
      .toMatchObject({ problem: { code: 'unavailable' } })
  })

  it('只返回明确缺失状态，不把残留正文带到缺原件结果', async () => {
    const result = await decodeProjectSupplierFileContent({ ...response(), state: 'missing', reason: 'missing-payload' }, query)
    expect(result).toMatchObject({ state: 'missing', reason: 'missing-payload' })
    expect(result).not.toHaveProperty('bytes')
    expect(result).not.toHaveProperty('payloadBase64')
  })

  it('取消后的迟到正文不返回可应用结果', async () => {
    const controller = new AbortController()
    const pending = decodeProjectSupplierFileContent(response(), query, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
