import { isTauri } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { exists, mkdir, open as openFile } from '@tauri-apps/plugin-fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pickExportDirectory } from '~/lib/platform/export-directory'

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ join: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  open: vi.fn(),
}))

function notFoundError() {
  return Object.assign(new Error('not found'), { name: 'NotFoundError' })
}

describe('桌面导出目录适配器', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('用最小权限目录选择器选择目录并写入其直接子文件', async () => {
    vi.mocked(openDialog).mockResolvedValue('D:\\导出')
    vi.mocked(join).mockResolvedValue('D:\\导出\\客户清单.txt')
    const write = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn().mockResolvedValue(undefined)
    vi.mocked(openFile).mockResolvedValue({ write, close } as never)

    const target = await pickExportDirectory()
    expect(openDialog).toHaveBeenCalledExactlyOnceWith({
      directory: true,
      multiple: false,
      recursive: false,
    })
    expect(target?.displayPath).toBe('D:\\导出')

    const bytes = new Uint8Array([1, 2, 3])
    await target?.writeFile('客户清单.txt', bytes, 'application/octet-stream')

    expect(join).toHaveBeenCalledExactlyOnceWith('D:\\导出', '客户清单.txt')
    expect(openFile).toHaveBeenCalledExactlyOnceWith('D:\\导出\\客户清单.txt', {
      write: true,
      createNew: true,
    })
    expect(write).toHaveBeenCalledExactlyOnceWith(bytes)
    expect(close).toHaveBeenCalledOnce()
  })

  it('关闭系统目录选择器时返回取消', async () => {
    vi.mocked(openDialog).mockResolvedValue(null)

    await expect(pickExportDirectory()).resolves.toBeNull()
    expect(openFile).not.toHaveBeenCalled()
  })

  it('配置导出申请递归目录权限并按相对路径逐级建目录', async () => {
    vi.mocked(openDialog).mockResolvedValue('D:\\导出')
    vi.mocked(join)
      .mockResolvedValueOnce('D:\\导出\\分供方\\材料')
      .mockResolvedValueOnce('D:\\导出\\分供方\\材料\\采购合同.txt')
    vi.mocked(mkdir).mockResolvedValue(undefined)
    const write = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn().mockResolvedValue(undefined)
    vi.mocked(openFile).mockResolvedValue({ write, close } as never)

    const target = await pickExportDirectory({ recursive: true })
    expect(openDialog).toHaveBeenCalledExactlyOnceWith({
      directory: true,
      multiple: false,
      recursive: true,
    })

    const bytes = new Uint8Array([4, 5, 6])
    await target?.writeFile('分供方/材料/采购合同.txt', bytes, 'text/plain')

    expect(join).toHaveBeenNthCalledWith(1, 'D:\\导出', '分供方', '材料')
    expect(mkdir).toHaveBeenCalledExactlyOnceWith('D:\\导出\\分供方\\材料', { recursive: true })
    expect(join).toHaveBeenNthCalledWith(2, 'D:\\导出', '分供方', '材料', '采购合同.txt')
    expect(openFile).toHaveBeenCalledExactlyOnceWith('D:\\导出\\分供方\\材料\\采购合同.txt', {
      write: true,
      createNew: true,
    })
    expect(write).toHaveBeenCalledExactlyOnceWith(bytes)
    expect(close).toHaveBeenCalledOnce()
  })

  it('桌面目标已有同名文件时原子创建递增序号，绝不覆盖', async () => {
    vi.mocked(openDialog).mockResolvedValue('D:\\导出')
    vi.mocked(join)
      .mockResolvedValueOnce('D:\\导出\\采购合同.txt')
      .mockResolvedValueOnce('D:\\导出\\采购合同 (2).txt')
    vi.mocked(openFile)
      .mockRejectedValueOnce(new Error('file already exists'))
      .mockResolvedValueOnce({
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      } as never)
    vi.mocked(exists).mockResolvedValueOnce(true)

    const target = await pickExportDirectory()
    const bytes = new Uint8Array([9, 8, 7])
    await target?.writeFile('采购合同.txt', bytes, 'text/plain')

    expect(openFile).toHaveBeenNthCalledWith(1, 'D:\\导出\\采购合同.txt', {
      write: true,
      createNew: true,
    })
    expect(exists).toHaveBeenCalledExactlyOnceWith('D:\\导出\\采购合同.txt')
    expect(openFile).toHaveBeenNthCalledWith(2, 'D:\\导出\\采购合同 (2).txt', {
      write: true,
      createNew: true,
    })
  })

  it('浏览器目录句柄逐级创建二级目录后写文件', async () => {
    vi.mocked(isTauri).mockReturnValue(false)
    const write = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn().mockResolvedValue(undefined)
    const getFileHandle = vi.fn().mockImplementation(async (_name, options: { create: boolean }) => {
      if (!options.create)
        throw notFoundError()
      return { createWritable: vi.fn().mockResolvedValue({ write, close }) }
    })
    const levelTwo = { name: '材料', getDirectoryHandle: vi.fn(), getFileHandle }
    const levelOne = {
      name: '分供方',
      getDirectoryHandle: vi.fn().mockResolvedValue(levelTwo),
      getFileHandle: vi.fn(),
    }
    const root = {
      name: '导出',
      getDirectoryHandle: vi.fn().mockResolvedValue(levelOne),
      getFileHandle: vi.fn(),
    }
    const showDirectoryPicker = vi.fn().mockResolvedValue(root)
    vi.stubGlobal('window', { showDirectoryPicker })
    vi.stubGlobal('document', {})

    const target = await pickExportDirectory({ recursive: true })
    const bytes = new Uint8Array([7, 8, 9])
    await target?.writeFile('分供方/材料/采购合同.txt', bytes, 'text/plain')

    expect(root.getDirectoryHandle).toHaveBeenCalledExactlyOnceWith('分供方', { create: true })
    expect(levelOne.getDirectoryHandle).toHaveBeenCalledExactlyOnceWith('材料', { create: true })
    expect(getFileHandle).toHaveBeenNthCalledWith(1, '采购合同.txt', { create: false })
    expect(getFileHandle).toHaveBeenNthCalledWith(2, '采购合同.txt', { create: true })
    expect(write).toHaveBeenCalledExactlyOnceWith(bytes)
    expect(close).toHaveBeenCalledOnce()
  })

  it('浏览器目标已有同名文件时递增序号后写入', async () => {
    vi.mocked(isTauri).mockReturnValue(false)
    const write = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn().mockResolvedValue(undefined)
    const getFileHandle = vi.fn().mockImplementation(async (name: string, options: { create: boolean }) => {
      if (!options.create && name === '采购合同.txt')
        return { createWritable: vi.fn() }
      if (!options.create)
        throw notFoundError()
      return { createWritable: vi.fn().mockResolvedValue({ write, close }) }
    })
    const root = { name: '导出', getDirectoryHandle: vi.fn(), getFileHandle }
    vi.stubGlobal('window', { showDirectoryPicker: vi.fn().mockResolvedValue(root) })
    vi.stubGlobal('document', {})

    const target = await pickExportDirectory({ recursive: true })
    const bytes = new Uint8Array([6, 5, 4])
    await target?.writeFile('采购合同.txt', bytes, 'text/plain')

    expect(getFileHandle).toHaveBeenNthCalledWith(1, '采购合同.txt', { create: false })
    expect(getFileHandle).toHaveBeenNthCalledWith(2, '采购合同 (2).txt', { create: false })
    expect(getFileHandle).toHaveBeenNthCalledWith(3, '采购合同 (2).txt', { create: true })
    expect(write).toHaveBeenCalledExactlyOnceWith(bytes)
  })

  it('拒绝写出所选目录之外的相对路径', async () => {
    vi.mocked(openDialog).mockResolvedValue('D:\\导出')
    const target = await pickExportDirectory({ recursive: true })

    await expect(target?.writeFile('../越界.txt', new Uint8Array())).rejects.toThrow('安全相对路径')
    expect(join).not.toHaveBeenCalled()
    expect(openFile).not.toHaveBeenCalled()
  })

  it('open 失败且 exists 自身报错时抛出 open 的原始错误', async () => {
    const openError = new Error('forbidden path')
    vi.mocked(openDialog).mockResolvedValue('D:\\导出')
    vi.mocked(join).mockResolvedValue('D:\\导出\\客户清单.txt')
    vi.mocked(openFile).mockRejectedValue(openError)
    vi.mocked(exists).mockRejectedValue(new Error('scope denied'))

    const target = await pickExportDirectory()
    await expect(target?.writeFile('客户清单.txt', new Uint8Array())).rejects.toBe(openError)
  })

  it('同一批写盘只为同一父目录建一次目录', async () => {
    vi.mocked(openDialog).mockResolvedValue('D:\\导出')
    vi.mocked(join).mockImplementation(async (...segments: string[]) => segments.join('\\'))
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(openFile).mockResolvedValue({
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as never)

    const target = await pickExportDirectory({ recursive: true })
    await target?.writeFile('分供方/材料/甲.txt', new Uint8Array())
    await target?.writeFile('分供方/材料/乙.txt', new Uint8Array())

    expect(mkdir).toHaveBeenCalledExactlyOnceWith('D:\\导出\\分供方\\材料', { recursive: true })
  })

  it('浏览器同名项是子目录时也按已占用换序号', async () => {
    vi.mocked(isTauri).mockReturnValue(false)
    const write = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn().mockResolvedValue(undefined)
    const getFileHandle = vi.fn().mockImplementation(async (name: string, options: { create: boolean }) => {
      if (!options.create && name === '采购合同.txt')
        throw Object.assign(new Error('is a directory'), { name: 'TypeMismatchError' })
      if (!options.create)
        throw notFoundError()
      return { createWritable: vi.fn().mockResolvedValue({ write, close }) }
    })
    const root = { name: '导出', getDirectoryHandle: vi.fn(), getFileHandle }
    vi.stubGlobal('window', { showDirectoryPicker: vi.fn().mockResolvedValue(root) })
    vi.stubGlobal('document', {})

    const target = await pickExportDirectory({ recursive: true })
    await target?.writeFile('采购合同.txt', new Uint8Array([1]))

    expect(getFileHandle).toHaveBeenNthCalledWith(2, '采购合同 (2).txt', { create: false })
    expect(getFileHandle).toHaveBeenNthCalledWith(3, '采购合同 (2).txt', { create: true })
    expect(write).toHaveBeenCalledOnce()
  })

  it('浏览器直接保存（非 recursive）拒绝含子目录的相对路径', async () => {
    vi.mocked(isTauri).mockReturnValue(false)
    const root = { name: '导出', getDirectoryHandle: vi.fn(), getFileHandle: vi.fn() }
    vi.stubGlobal('window', { showDirectoryPicker: vi.fn().mockResolvedValue(root) })
    vi.stubGlobal('document', {})

    const target = await pickExportDirectory()
    await expect(target?.writeFile('子目录/文件.txt', new Uint8Array()))
      .rejects
      .toThrow('当前目录权限不允许创建导出子目录')
    expect(root.getDirectoryHandle).not.toHaveBeenCalled()
  })

  it('浏览器没有 File System Access API 时返回明确的不支持目录目标', async () => {
    vi.mocked(isTauri).mockReturnValue(false)
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', {})

    const target = await pickExportDirectory({ recursive: true })

    expect(target).toMatchObject({
      displayPath: '浏览器下载',
      supportsSubdirectories: false,
    })
  })
})
