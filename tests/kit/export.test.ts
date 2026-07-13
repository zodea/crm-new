import { describe, expect, it, vi } from 'vitest'
import { chooseExportPath, exportFile } from '~/lib/kit/export'

describe('导出路径分流：chooseExportPath', () => {
  it('无需配置目录结构时直接保存', () => {
    expect(chooseExportPath({ requiresDirectoryStructure: false })).toBe('direct-save')
  })

  it('需要配置目录结构时进入配置页', () => {
    expect(chooseExportPath({ requiresDirectoryStructure: true })).toBe('config-tab')
  })
})

describe('直接保存：exportFile', () => {
  it('用户取消目录选择时静默结束', async () => {
    const during = vi.fn()
    const success = vi.fn()
    const failure = vi.fn()

    await expect(exportFile({ data: 'demo', defaultName: 'demo.txt' }, {
      pickDirectory: vi.fn().mockResolvedValue(null),
      feedback: { during, success, failure },
    })).resolves.toEqual({ status: 'cancelled' })

    expect(during).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
    expect(failure).not.toHaveBeenCalled()
  })

  it('目录选择器异常时报告失败并透传错误', async () => {
    const pickerFailure = new Error('目录权限不足')
    const during = vi.fn()
    const success = vi.fn()
    const failure = vi.fn()

    await expect(exportFile({ data: 'demo', defaultName: 'demo.txt' }, {
      pickDirectory: vi.fn().mockRejectedValue(pickerFailure),
      feedback: { during, success, failure },
    })).rejects.toBe(pickerFailure)

    expect(failure).toHaveBeenCalledExactlyOnceWith(pickerFailure)
    expect(during).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
  })

  it('写入指定文件并只报告一次最终成功', async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined)
    const during = vi.fn(async <T>(task: () => Promise<T>) => await task())
    const success = vi.fn()
    const failure = vi.fn()

    await expect(exportFile({
      data: '瑞航 CRM',
      defaultName: '客户清单.txt',
      mimeType: 'text/plain;charset=utf-8',
    }, {
      pickDirectory: vi.fn().mockResolvedValue({
        displayPath: 'D:\\导出',
        writeFile,
      }),
      feedback: { during, success, failure },
    })).resolves.toEqual({ status: 'exported', displayPath: 'D:\\导出' })

    expect(writeFile).toHaveBeenCalledOnce()
    expect(during.mock.invocationCallOrder[0]).toBeLessThan(writeFile.mock.invocationCallOrder[0]!)
    expect(writeFile).toHaveBeenCalledWith(
      '客户清单.txt',
      new TextEncoder().encode('瑞航 CRM'),
      'text/plain;charset=utf-8',
    )
    expect(during).toHaveBeenCalledOnce()
    expect(success).toHaveBeenCalledExactlyOnceWith('已导出到 D:\\导出 文件夹')
    expect(failure).not.toHaveBeenCalled()
  })

  it('写入失败时透传错误且不误报成功', async () => {
    const failure = new Error('磁盘已满')
    const during = vi.fn(async <T>(task: () => Promise<T>) => await task())
    const success = vi.fn()
    const selectFailure = vi.fn()

    await expect(exportFile({ data: new Uint8Array([1, 2]), defaultName: 'demo.bin' }, {
      pickDirectory: vi.fn().mockResolvedValue({
        displayPath: 'D:\\导出',
        writeFile: vi.fn().mockRejectedValue(failure),
      }),
      feedback: { during, success, failure: selectFailure },
    })).rejects.toBe(failure)

    expect(during).toHaveBeenCalledOnce()
    expect(success).not.toHaveBeenCalled()
    expect(selectFailure).not.toHaveBeenCalled()
  })
})
