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
  it('同步请求保存位置，选定后才读取慢速正文并写入相同字节', async () => {
    const events: string[] = []
    const data = new Uint8Array([37, 80, 68, 70])
    const read = vi.fn(async () => {
      events.push('read')
      return data
    })
    const writeFile = vi.fn(async () => {
      events.push('write')
    })
    let choose!: (value: any) => void
    const pending = exportFile({ data: read, defaultName: '原件.pdf' }, {
      pickDirectory: () => {
        events.push('pick')
        return new Promise((resolve) => {
          choose = resolve
        })
      },
      feedback: { during: task => task(), success: vi.fn(), failure: vi.fn() },
    })
    expect(events).toEqual(['pick'])
    choose({ displayPath: '目标目录', supportsSubdirectories: true, writeFile })
    await expect(pending).resolves.toEqual({ status: 'exported', displayPath: '目标目录' })
    expect(events).toEqual(['pick', 'read', 'write'])
    expect(writeFile).toHaveBeenCalledWith('原件.pdf', data, undefined)
  })

  it('取消保存位置时不读取惰性正文', async () => {
    const read = vi.fn(async () => '原件')
    await expect(exportFile({ data: read, defaultName: '原件.pdf' }, {
      pickDirectory: async () => null,
      feedback: { during: task => task(), success: vi.fn(), failure: vi.fn() },
    })).resolves.toEqual({ status: 'cancelled' })
    expect(read).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'reject'])('读取正文期间取消后迟到 %s 不写盘、不触发失败反馈', async (outcome) => {
    const controller = new AbortController()
    const writeFile = vi.fn()
    const success = vi.fn()
    const failure = vi.fn()
    let resolve!: (value: string) => void
    let reject!: (error: Error) => void
    const read = vi.fn(() => new Promise<string>((done, fail) => {
      resolve = done
      reject = fail
    }))
    const pending = exportFile({ data: read, defaultName: '原件.pdf', signal: controller.signal }, {
      pickDirectory: async () => ({ displayPath: '目标目录', supportsSubdirectories: true, writeFile }),
      feedback: { during: async (task) => {
        try {
          return await task()
        }
        catch (error) {
          failure(error)
          throw error
        }
      }, success, failure },
    })
    await Promise.resolve()
    expect(read).toHaveBeenCalledOnce()
    controller.abort()
    if (outcome === 'resolve')
      resolve('迟到正文')
    else reject(new Error('迟到失败'))
    await expect(pending).resolves.toEqual({ status: 'cancelled' })
    expect(writeFile).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
    expect(failure).not.toHaveBeenCalled()
  })

  it('惰性正文读取失败时由统一进度反馈报告且不创建文件', async () => {
    const cause = new Error('中央正文校验失败')
    const writeFile = vi.fn()
    const success = vi.fn()
    const during = vi.fn(async <T>(task: () => Promise<T>) => task())
    await expect(exportFile({ data: async () => {
      throw cause
    }, defaultName: '原件.pdf' }, {
      pickDirectory: async () => ({ displayPath: '目标目录', supportsSubdirectories: true, writeFile }),
      feedback: { during, success, failure: vi.fn() },
    })).rejects.toBe(cause)
    expect(during).toHaveBeenCalledOnce()
    expect(writeFile).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
  })

  it('等待目录期间来源已失效时静默取消，不写入旧原件', async () => {
    const controller = new AbortController()
    const writeFile = vi.fn()
    const during = vi.fn(async <T>(task: () => Promise<T>) => await task())
    const success = vi.fn()
    const failure = vi.fn()
    let choose!: (value: any) => void
    const pending = exportFile({ data: '旧关系原件', defaultName: '原件.pdf', signal: controller.signal }, {
      pickDirectory: () => new Promise((resolve) => { choose = resolve }),
      feedback: { during, success, failure },
    })
    controller.abort()
    choose({ displayPath: '目标目录', supportsSubdirectories: true, writeFile })
    await expect(pending).resolves.toEqual({ status: 'cancelled' })
    expect(writeFile).not.toHaveBeenCalled()
    expect(during).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
    expect(failure).not.toHaveBeenCalled()
  })

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
