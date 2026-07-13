import { isTauri } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pickExportDirectory } from '~/lib/platform/export-directory'

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ join: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn() }))

describe('桌面导出目录适配器', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(true)
  })

  it('用最小权限目录选择器选择目录并写入其直接子文件', async () => {
    vi.mocked(open).mockResolvedValue('D:\\导出')
    vi.mocked(join).mockResolvedValue('D:\\导出\\客户清单.txt')
    vi.mocked(writeFile).mockResolvedValue(undefined)

    const target = await pickExportDirectory()
    expect(open).toHaveBeenCalledExactlyOnceWith({
      directory: true,
      multiple: false,
      recursive: false,
    })
    expect(target?.displayPath).toBe('D:\\导出')

    const bytes = new Uint8Array([1, 2, 3])
    await target?.writeFile('客户清单.txt', bytes, 'application/octet-stream')

    expect(join).toHaveBeenCalledExactlyOnceWith('D:\\导出', '客户清单.txt')
    expect(writeFile).toHaveBeenCalledExactlyOnceWith('D:\\导出\\客户清单.txt', bytes)
  })

  it('关闭系统目录选择器时返回取消', async () => {
    vi.mocked(open).mockResolvedValue(null)

    await expect(pickExportDirectory()).resolves.toBeNull()
    expect(writeFile).not.toHaveBeenCalled()
  })
})
