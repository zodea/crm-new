import { isTauri } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { select } from '~/lib/db/connection'
import { loadFileRefContent } from '~/lib/forms/file-refs'

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(),
}))

vi.mock('~/lib/db/connection', () => ({
  select: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(select).mockResolvedValue([])
})

describe('legacy supplier credential file isolation', () => {
  it('桌面端也不读取或缓存 legacy 证照路径', async () => {
    vi.mocked(isTauri).mockReturnValue(true)

    await expect(loadFileRefContent({
      id: 'file-ref-1',
      ownerType: 'supplier_credential',
      filePath: 'D:\\历史资料\\营业执照.pdf',
      mimeType: 'application/pdf',
    })).resolves.toBeNull()
  })

  it('浏览器环境不会尝试读取仅有本地路径的 legacy 文件', async () => {
    vi.mocked(isTauri).mockReturnValue(false)

    await expect(loadFileRefContent({
      id: 'file-ref-1',
      ownerType: 'supplier_credential',
      filePath: 'D:\\历史资料\\营业执照.pdf',
      mimeType: 'application/pdf',
    })).resolves.toBeNull()
  })
})
