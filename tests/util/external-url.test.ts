import { afterEach, describe, expect, it, vi } from 'vitest'
import { openExternalUrl } from '~/lib/platform/external-url'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('external URL platform boundary', () => {
  it('使用带 noopener 的新窗口并报告拦截', async () => {
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
