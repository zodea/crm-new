import { beforeEach, describe, expect, it, vi } from 'vitest'
import { select } from '~/lib/db/connection'
import { loadFileRefContent } from '~/lib/forms/file-refs'

vi.mock('~/lib/db/connection', () => ({
  select: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(select).mockResolvedValue([])
})

describe('file reference content access', () => {
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

  it('归属不匹配、已删除或只有 legacy 路径时不返回正文', async () => {
    await expect(loadFileRefContent({
      id: 'file-ref-1',
      ownerType: 'supplier_credential',
      ownerId: 'credential-1',
    })).resolves.toBeNull()
  })
})
