import { invoke, isTauri } from '@tauri-apps/api/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openExternalUrl } from '~/lib/platform/external-url'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('external URL platform boundary', () => {
  it('tauri 通过受控命令交给系统默认浏览器', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockResolvedValue(undefined)

    await expect(openExternalUrl('https://example.com')).resolves.toBe(true)
    expect(invoke).toHaveBeenCalledWith('open_external_url', {
      url: 'https://example.com',
    })
  })

  it('浏览器环境使用带 noopener 的新窗口并报告拦截', async () => {
    vi.mocked(isTauri).mockReturnValue(false)
    const open = vi.fn().mockReturnValue(null)
    vi.stubGlobal('window', { open })

    await expect(openExternalUrl('https://example.com')).resolves.toBe(false)
    expect(open).toHaveBeenCalledWith(
      'https://example.com',
      '_blank',
      'noopener,noreferrer',
    )
  })
})
