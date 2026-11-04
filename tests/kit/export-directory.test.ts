import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pickExportDirectory } from '~/lib/platform/export-directory'

function notFoundError() {
  return Object.assign(new Error('not found'), { name: 'NotFoundError' })
}

describe('浏览器导出目录适配器', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('浏览器目录句柄逐级创建二级目录后写文件', async () => {
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

  it('浏览器同名项是子目录时也按已占用换序号', async () => {
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
    const root = { name: '导出', getDirectoryHandle: vi.fn(), getFileHandle: vi.fn() }
    vi.stubGlobal('window', { showDirectoryPicker: vi.fn().mockResolvedValue(root) })
    vi.stubGlobal('document', {})

    const target = await pickExportDirectory()
    await expect(target?.writeFile('子目录/文件.txt', new Uint8Array()))
      .rejects
      .toThrow('当前目录权限不允许创建导出子目录')
    expect(root.getDirectoryHandle).not.toHaveBeenCalled()
  })

  it.each([
    { case: '权限被撤销', name: 'NotAllowedError' },
    { case: '安全限制', name: 'SecurityError' },
    { case: '存储设备错误', name: 'UnknownError' },
  ])('同名探测遇到$case时保留原错误，不尝试创建或写入', async ({ name }) => {
    const cause = Object.assign(new Error('无法核验目标文件'), { name })
    const getFileHandle = vi.fn().mockRejectedValue(cause)
    const root = { name: '导出', getDirectoryHandle: vi.fn(), getFileHandle }
    vi.stubGlobal('window', { showDirectoryPicker: vi.fn().mockResolvedValue(root) })
    vi.stubGlobal('document', {})

    const target = await pickExportDirectory({ recursive: true })
    expect(target).not.toBeNull()
    await expect(target!.writeFile('采购合同.txt', new Uint8Array([1]))).rejects.toBe(cause)
    expect(getFileHandle).toHaveBeenCalledExactlyOnceWith('采购合同.txt', { create: false })
    expect(root.getDirectoryHandle).not.toHaveBeenCalled()
  })

  it.each(['', '.', '..', '../文件.txt', '目录/../文件.txt', '目录\\..\\文件.txt'])('拒绝不安全相对路径 %j，不访问所选目录', async (path) => {
    const root = { name: '导出', getDirectoryHandle: vi.fn(), getFileHandle: vi.fn() }
    vi.stubGlobal('window', { showDirectoryPicker: vi.fn().mockResolvedValue(root) })
    vi.stubGlobal('document', {})

    const target = await pickExportDirectory({ recursive: true })
    expect(target).not.toBeNull()
    await expect(target!.writeFile(path, new Uint8Array([1]))).rejects.toThrow('导出文件路径必须是所选目录内的安全相对路径')
    expect(root.getDirectoryHandle).not.toHaveBeenCalled()
    expect(root.getFileHandle).not.toHaveBeenCalled()
  })

  it('用户取消选择目录时返回空结果，其他错误保留原因', async () => {
    const cancelled = Object.assign(new Error('用户取消'), { name: 'AbortError' })
    const unavailable = Object.assign(new Error('目录不可用'), { name: 'NotAllowedError' })
    const picker = vi.fn().mockRejectedValueOnce(cancelled).mockRejectedValueOnce(unavailable)
    vi.stubGlobal('window', { showDirectoryPicker: picker })
    vi.stubGlobal('document', {})

    await expect(pickExportDirectory()).resolves.toBeNull()
    await expect(pickExportDirectory()).rejects.toBe(unavailable)
    expect(picker).toHaveBeenCalledTimes(2)
    expect(picker).toHaveBeenNthCalledWith(1, { mode: 'readwrite' })
    expect(picker).toHaveBeenNthCalledWith(2, { mode: 'readwrite' })
  })

  it('比较目录句柄实际身份，而不是比较目录名称', async () => {
    const sameEntry = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const firstHandle = { name: '导出', isSameEntry: sameEntry, getDirectoryHandle: vi.fn(), getFileHandle: vi.fn() }
    const sameHandle = { name: '导出', getDirectoryHandle: vi.fn(), getFileHandle: vi.fn() }
    const differentHandle = { name: '导出', getDirectoryHandle: vi.fn(), getFileHandle: vi.fn() }
    vi.stubGlobal('window', { showDirectoryPicker: vi.fn().mockResolvedValueOnce(firstHandle).mockResolvedValueOnce(sameHandle).mockResolvedValueOnce(differentHandle) })
    vi.stubGlobal('document', {})

    const first = await pickExportDirectory({ recursive: true })
    const same = await pickExportDirectory({ recursive: true })
    const different = await pickExportDirectory({ recursive: true })
    expect(await first!.sameDirectory!(same!)).toBe(true)
    expect(await first!.sameDirectory!(different!)).toBe(false)
    expect(sameEntry).toHaveBeenNthCalledWith(1, sameHandle)
    expect(sameEntry).toHaveBeenNthCalledWith(2, differentHandle)
  })

  it('身份比较不支持或失去权限时明确报错，不将其当成相同或不同目录', async () => {
    const unsupported = { name: '导出', getDirectoryHandle: vi.fn(), getFileHandle: vi.fn() }
    const denied = { name: '导出', isSameEntry: vi.fn().mockRejectedValue(new Error('权限已失效')), getDirectoryHandle: vi.fn(), getFileHandle: vi.fn() }
    vi.stubGlobal('window', { showDirectoryPicker: vi.fn().mockResolvedValueOnce(unsupported).mockResolvedValueOnce(denied) })
    vi.stubGlobal('document', {})

    const first = await pickExportDirectory({ recursive: true })
    const second = await pickExportDirectory({ recursive: true })
    await expect(first!.sameDirectory!(second!)).rejects.toThrow('无法核对导出目录身份')
    await expect(second!.sameDirectory!(first!)).rejects.toThrow('无法核对导出目录身份')
  })

  it('浏览器没有 File System Access API 时返回明确的不支持目录目标', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', {})

    const target = await pickExportDirectory({ recursive: true })

    expect(target).toMatchObject({
      displayPath: '浏览器下载',
      supportsSubdirectories: false,
    })
  })
})
