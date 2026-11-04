import type { ConfiguredExportSettings, ConfiguredExportSource, ExportDirectoryTarget } from '~/lib/kit/export'
import { describe, expect, it, vi } from 'vitest'
import { useConfiguredExportRunner } from '~/composables/useConfiguredExportRunner'

const source: ConfiguredExportSource = {
  label: '采购合同',
  fields: [
    { key: 'projectName', label: '项目' },
    { key: 'supplierName', label: '分供方' },
  ],
  files: [{
    row: { projectName: '滨江壹号', supplierName: '华东建材' },
    data: '合同正文',
    mimeType: 'text/plain',
  }],
}

const settings: ConfiguredExportSettings = {
  structure: {
    levels: [{ field: 'projectName' }, { field: 'supplierName' }],
  },
  naming: {
    parts: [{ field: 'supplierName' }],
    extension: 'txt',
  },
}

function target(overrides: Partial<ExportDirectoryTarget> = {}): ExportDirectoryTarget {
  return {
    displayPath: 'D:\\导出',
    supportsSubdirectories: true,
    writeFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('配置导出运行器', () => {
  it('依次完成读数据、生成与写盘，并返回唯一落点', async () => {
    const directory = target()
    const runner = useConfiguredExportRunner(source, settings, {
      pickDirectory: vi.fn().mockResolvedValue(directory),
      yieldToView: vi.fn().mockResolvedValue(undefined),
    })

    await expect(runner.start()).resolves.toEqual({
      status: 'exported',
      displayPath: 'D:\\导出',
    })
    expect(runner.stepper.value.phase).toBe('completed')
    expect(runner.stepper.value.steps.map(step => step.status)).toEqual([
      'completed',
      'completed',
      'completed',
    ])
    expect(directory.writeFile).toHaveBeenCalledExactlyOnceWith(
      '滨江壹号/华东建材/华东建材.txt',
      new TextEncoder().encode('合同正文'),
      'text/plain',
    )
  })

  it('取消目录选择时静默回到初始态且不写文件', async () => {
    const runner = useConfiguredExportRunner(source, settings, {
      pickDirectory: vi.fn().mockResolvedValue(null),
      yieldToView: vi.fn().mockResolvedValue(undefined),
    })

    await expect(runner.start()).resolves.toEqual({ status: 'cancelled' })
    expect(runner.stepper.value.phase).toBe('idle')
    expect(runner.error.value).toBeNull()
  })

  it('重试选择同一落点时跳过已写文件，只补写剩余文件', async () => {
    const multiFileSource: ConfiguredExportSource = {
      ...source,
      files: [
        { row: { projectName: '滨江壹号', supplierName: '华东建材' }, data: '第一份' },
        { row: { projectName: '滨江壹号', supplierName: '南方设备' }, data: '第二份' },
      ],
    }
    const failingTarget = target({
      writeFile: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('磁盘已满')),
      sameDirectory: vi.fn().mockResolvedValue(true),
    })
    const retryTarget = target()
    const runner = useConfiguredExportRunner(multiFileSource, settings, {
      pickDirectory: vi.fn()
        .mockResolvedValueOnce(failingTarget)
        .mockResolvedValueOnce(retryTarget),
      yieldToView: vi.fn().mockResolvedValue(undefined),
    })

    await expect(runner.start()).resolves.toMatchObject({ status: 'failed' })
    expect(failingTarget.writeFile).toHaveBeenCalledTimes(2)

    await expect(runner.retry()).resolves.toEqual({
      status: 'exported',
      displayPath: 'D:\\导出',
    })
    // 同一落点：第一份上次已写成功，重试只补写第二份，不产生 (2) 副本。
    expect(retryTarget.writeFile).toHaveBeenCalledExactlyOnceWith(
      '滨江壹号/南方设备/南方设备.txt',
      new TextEncoder().encode('第二份'),
      undefined,
    )
  })

  it('重试换落点时整批重写，不遗漏上次已写文件', async () => {
    const multiFileSource: ConfiguredExportSource = {
      ...source,
      files: [
        { row: { projectName: '滨江壹号', supplierName: '华东建材' }, data: '第一份' },
        { row: { projectName: '滨江壹号', supplierName: '南方设备' }, data: '第二份' },
      ],
    }
    const failingTarget = target({
      writeFile: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('磁盘已满')),
      sameDirectory: vi.fn().mockResolvedValue(false),
    })
    const otherTarget = target({ displayPath: 'E:\\备份' })
    const runner = useConfiguredExportRunner(multiFileSource, settings, {
      pickDirectory: vi.fn()
        .mockResolvedValueOnce(failingTarget)
        .mockResolvedValueOnce(otherTarget),
      yieldToView: vi.fn().mockResolvedValue(undefined),
    })

    await expect(runner.start()).resolves.toMatchObject({ status: 'failed' })
    await expect(runner.retry()).resolves.toEqual({
      status: 'exported',
      displayPath: 'E:\\备份',
    })
    expect(otherTarget.writeFile).toHaveBeenCalledTimes(2)
    expect(otherTarget.writeFile).toHaveBeenNthCalledWith(1, '滨江壹号/华东建材/华东建材.txt', new TextEncoder().encode('第一份'), undefined)
    expect(otherTarget.writeFile).toHaveBeenNthCalledWith(2, '滨江壹号/南方设备/南方设备.txt', new TextEncoder().encode('第二份'), undefined)
  })

  it('重试选择名称相同但身份不同的目录时，重新写入全部文件', async () => {
    const multiFileSource: ConfiguredExportSource = {
      ...source,
      files: [
        { row: { projectName: '滨江壹号', supplierName: '华东建材' }, data: '第一份' },
        { row: { projectName: '滨江壹号', supplierName: '南方设备' }, data: '第二份' },
      ],
    }
    const first = Object.assign(target({
      displayPath: '导出',
      writeFile: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('磁盘已满')),
    }), { sameDirectory: vi.fn().mockResolvedValue(false) })
    const second = target({ displayPath: '导出' })
    const runner = useConfiguredExportRunner(multiFileSource, settings, {
      pickDirectory: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second),
      yieldToView: vi.fn().mockResolvedValue(undefined),
    })

    expect(await runner.start()).toMatchObject({ status: 'failed' })
    expect(await runner.retry()).toEqual({ status: 'exported', displayPath: '导出' })
    expect(second.writeFile).toHaveBeenCalledTimes(2)
    expect(first.sameDirectory).toHaveBeenCalledExactlyOnceWith(second)
    expect(second.writeFile).toHaveBeenNthCalledWith(1, '滨江壹号/华东建材/华东建材.txt', new TextEncoder().encode('第一份'), undefined)
    expect(second.writeFile).toHaveBeenNthCalledWith(2, '滨江壹号/南方设备/南方设备.txt', new TextEncoder().encode('第二份'), undefined)
  })

  it('目录身份比较失败时停止且保留进度，核对恢复后只补写未完成文件', async () => {
    const multiFileSource: ConfiguredExportSource = {
      ...source,
      files: [
        { row: { projectName: '滨江壹号', supplierName: '华东建材' }, data: '第一份' },
        { row: { projectName: '滨江壹号', supplierName: '南方设备' }, data: '第二份' },
      ],
    }
    const identityError = new Error('无法核对导出目录身份，已保留进度')
    const sameDirectory = vi.fn().mockRejectedValueOnce(identityError).mockResolvedValueOnce(true)
    const first = target({ sameDirectory, writeFile: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('磁盘已满')) })
    const unverifiable = target()
    const recovered = target()
    const runner = useConfiguredExportRunner(multiFileSource, settings, {
      pickDirectory: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(unverifiable).mockResolvedValueOnce(recovered),
      yieldToView: vi.fn().mockResolvedValue(undefined),
    })

    expect(await runner.start()).toMatchObject({ status: 'failed' })
    expect(await runner.retry()).toEqual({ status: 'failed', error: identityError })
    expect(runner.error.value).toBe('无法核对导出目录身份，已保留进度')
    expect(unverifiable.writeFile).not.toHaveBeenCalled()
    expect(await runner.retry()).toEqual({ status: 'exported', displayPath: 'D:\\导出' })
    expect(recovered.writeFile).toHaveBeenCalledExactlyOnceWith('滨江壹号/南方设备/南方设备.txt', new TextEncoder().encode('第二份'), undefined)
  })

  it('落点不支持身份比较时停止，不能按同名假定为原目录', async () => {
    const multiFileSource: ConfiguredExportSource = {
      ...source,
      files: [
        { row: { projectName: '滨江壹号', supplierName: '华东建材' }, data: '第一份' },
        { row: { projectName: '滨江壹号', supplierName: '南方设备' }, data: '第二份' },
      ],
    }
    const first = target({ writeFile: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('磁盘已满')) })
    const second = target()
    const runner = useConfiguredExportRunner(multiFileSource, settings, {
      pickDirectory: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second),
      yieldToView: vi.fn().mockResolvedValue(undefined),
    })

    expect(await runner.start()).toMatchObject({ status: 'failed' })
    expect(await runner.retry()).toMatchObject({ status: 'failed', error: { message: expect.stringContaining('无法核对导出目录身份') } })
    expect(second.writeFile).not.toHaveBeenCalled()
    expect(runner.stepper.value.phase).toBe('failed')
  })

  it('写盘失败保留失败步，重试从写盘继续', async () => {
    const writeError = new Error('磁盘已满')
    const firstTarget = target({
      writeFile: vi.fn().mockRejectedValueOnce(writeError),
    })
    const secondTarget = target()
    const pickDirectory = vi.fn()
      .mockResolvedValueOnce(firstTarget)
      .mockResolvedValueOnce(secondTarget)
    const runner = useConfiguredExportRunner(source, settings, {
      pickDirectory,
      yieldToView: vi.fn().mockResolvedValue(undefined),
    })

    const result = await runner.start()
    expect(result.status).toBe('failed')
    if (result.status !== 'failed')
      throw new Error('导出失败时未返回原始错误')
    expect(result.error).toBe(writeError)
    expect(runner.stepper.value.phase).toBe('failed')
    expect(runner.stepper.value.steps.map(step => step.status)).toEqual([
      'completed',
      'completed',
      'failed',
    ])
    expect(runner.error.value).toBe('磁盘已满')
    expect(firstTarget.writeFile).toHaveBeenCalledOnce()
    expect(pickDirectory).toHaveBeenCalledOnce()
    expect(secondTarget.writeFile).not.toHaveBeenCalled()

    await expect(runner.retry()).resolves.toEqual({
      status: 'exported',
      displayPath: 'D:\\导出',
    })
    expect(pickDirectory).toHaveBeenCalledTimes(2)
    expect(secondTarget.writeFile).toHaveBeenCalledOnce()
  })

  it('浏览器扁平下载不能伪装成已创建二级目录', async () => {
    const directory = target({
      displayPath: '浏览器下载',
      supportsSubdirectories: false,
    })
    const runner = useConfiguredExportRunner(source, settings, {
      pickDirectory: vi.fn().mockResolvedValue(directory),
      yieldToView: vi.fn().mockResolvedValue(undefined),
    })

    await expect(runner.start()).resolves.toMatchObject({ status: 'failed' })
    expect(runner.stepper.value.steps.at(-1)?.status).toBe('failed')
    expect(runner.error.value).toContain('不支持保留目录结构')
    expect(directory.writeFile).not.toHaveBeenCalled()
  })
})
