import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useQuantityStore } from '~/stores/quantity'

const host = vi.hoisted(() => ({ native: false, browser: vi.fn(() => ({ source: 'central' })), desktop: vi.fn(() => ({ source: 'sqlite' })) }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => host.native }))
vi.mock('~/stores/quantity-browser', () => ({ useBrowserQuantityStore: host.browser }))
vi.mock('~/stores/quantity-native', () => ({ useNativeQuantityStore: host.desktop }))
beforeEach(() => {
  host.browser.mockClear()
  host.desktop.mockClear()
})

describe('工程量运行环境入口', () => {
  it('浏览器只建立中央 store，桌面只建立 SQLite store', () => {
    host.native = false
    expect(useQuantityStore()).toEqual({ source: 'central' })
    expect(host.desktop).not.toHaveBeenCalled()
    host.native = true
    expect(useQuantityStore()).toEqual({ source: 'sqlite' })
    expect(host.browser).toHaveBeenCalledTimes(1)
  })
})
