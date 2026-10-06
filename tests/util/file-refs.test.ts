import type { TransactionDb } from '~/lib/db/coordinator'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { select } from '~/lib/db/connection'
import { applyFileRefChanges, loadFileRefContent } from '~/lib/forms/file-refs'

vi.mock('~/lib/db/connection', () => ({
  select: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(select).mockResolvedValue([])
})

describe('file reference content access', () => {
  it('真实空文件写入空正文；旧路径没有正文时只保存原引用，二者不可互换', async () => {
    const execute = vi.fn(async () => ({ rowsAffected: 1 }))
    const tx = { execute, select: vi.fn(async () => []) } as unknown as TransactionDb
    const ids = await applyFileRefChanges(tx, 'contract', 'contract-1', { add: [
      { fileName: 'empty.txt', fileSize: 0, payloadBase64: '', mimeType: 'text/plain' },
      { fileName: 'old.txt', filePath: 'C:/legacy/old.txt', fileSize: 0 },
    ] })
    const payloads = execute.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO file_payloads'))
    expect(ids).toHaveLength(2)
    expect(payloads).toHaveLength(1)
    expect(payloads[0]![1]).toEqual([ids[0], ''])
  })
  it('点击时按文件 id、归属和未删除状态重验正文', async () => {
    vi.mocked(select).mockResolvedValue([{
      encoding: 'base64',
      content: 'AQID',
      mime_type: 'application/pdf',
    }])

    await expect(loadFileRefContent({
      id: 'file-ref-1',
      ownerType: 'contract',
      ownerId: 'contract-1',
    })).resolves.toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'application/pdf',
    })
    expect(select).toHaveBeenCalledWith(
      expect.stringContaining('file.deleted_at IS NULL'),
      ['file-ref-1', 'contract', 'contract-1'],
    )
  })

  it('读取已存零字节原件返回空 bytes；没有 payload 行保持缺件', async () => {
    vi.mocked(select).mockResolvedValueOnce([{ encoding: 'base64', content: '', mime_type: 'text/plain' }])
    await expect(loadFileRefContent({ id: 'empty-original', ownerType: 'contract', ownerId: 'contract-1' })).resolves.toEqual({ bytes: new Uint8Array(), mimeType: 'text/plain' })
    vi.mocked(select).mockResolvedValueOnce([{ encoding: null, content: null, mime_type: 'text/plain' }])
    await expect(loadFileRefContent({ id: 'missing-original', ownerType: 'contract', ownerId: 'contract-1' })).resolves.toBeNull()
  })

  it('归属不匹配、已删除或只有 legacy 路径时不返回正文', async () => {
    await expect(loadFileRefContent({
      id: 'file-ref-1',
      ownerType: 'supplier_credential',
      ownerId: 'credential-1',
    })).resolves.toBeNull()
  })
})
