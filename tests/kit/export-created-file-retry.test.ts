import { afterEach, expect, it, vi } from 'vitest'
import { useConfiguredExportRunner } from '~/composables/useConfiguredExportRunner'
import { pickExportDirectory } from '~/lib/platform/export-directory'

afterEach(() => vi.unstubAllGlobals())

type FailureStage = 'create' | 'open' | 'write' | 'close'

function syntheticDirectory(failureStage: FailureStage = 'open', abortFails = false, collision = false) {
  const files = new Map<string, Uint8Array>([['已有资料.txt', new TextEncoder().encode('既有资料')]])
  if (collision)
    files.set('凭证.txt', new TextEncoder().encode('已有同名资料'))
  const cause = Object.assign(new Error('目录写入权限已失效'), { name: 'NotAllowedError' })
  const abort = vi.fn(async () => {
    if (abortFails)
      throw new Error('流终止失败')
  })
  let failed = false
  function fail(stage: FailureStage) {
    if (!failed && stage === failureStage) {
      failed = true
      throw cause
    }
  }
  const directory = {
    name: '合成目录',
    async isSameEntry(other: unknown) { return other === directory },
    async getDirectoryHandle() { return directory },
    async getFileHandle(name: string, options: { create: boolean }) {
      if (!files.has(name)) {
        if (!options.create)
          throw Object.assign(new Error('不存在'), { name: 'NotFoundError' })
        files.set(name, new Uint8Array())
        fail('create')
      }
      return {
        async createWritable() {
          fail('open')
          let pending = new Uint8Array()
          return {
            async write(data: Uint8Array) {
              fail('write')
              pending = Uint8Array.from(data)
            },
            async close() {
              fail('close')
              files.set(name, pending)
            },
            abort,
          }
        },
      }
    },
  }
  return { directory, files, cause, abort }
}

function setup(failureStage: FailureStage = 'open', abortFails = false, collision = false) {
  const { directory, files, cause, abort } = syntheticDirectory(failureStage, abortFails, collision)
  vi.stubGlobal('window', { showDirectoryPicker: vi.fn().mockResolvedValue(directory) })
  vi.stubGlobal('document', {})
  const runner = useConfiguredExportRunner(
    { label: '合成资料', fields: [{ key: 'name', label: '名称' }], files: [{ row: { name: '凭证' }, data: '完整合成正文', mimeType: 'text/plain' }] },
    { structure: { levels: [] }, naming: { parts: [{ field: 'name' }], extension: 'txt' } },
    { pickDirectory: () => pickExportDirectory({ recursive: true }), yieldToView: async () => {} },
  )
  return { runner, files, cause, abort }
}

it('真实目录适配器在创建文件后失权，重试同目录会把成品写到后缀文件', async () => {
  const { runner, files } = setup()
  expect(await runner.start()).toMatchObject({ status: 'failed' })
  expect(runner.error.value).toContain('目录写入权限已失效')
  expect(files.get('凭证.txt')).toEqual(new Uint8Array())
  expect(await runner.retry()).toEqual({ status: 'exported', displayPath: '合成目录' })
  expect(files.get('凭证.txt')).toEqual(new Uint8Array())
  expect(files.get('凭证 (2).txt')).toEqual(new TextEncoder().encode('完整合成正文'))
  expect(files.get('已有资料.txt')).toEqual(new TextEncoder().encode('既有资料'))
})

it('创建后写入失败时应提醒用户可能留下未完成文件', async () => {
  const { runner, files } = setup()
  expect(await runner.start()).toMatchObject({ status: 'failed' })
  expect(files.get('凭证.txt')).toEqual(new Uint8Array())
  expect(runner.error.value).toMatch(/空文件|未完成文件/)
})

it.each(['create', 'open', 'write', 'close'] as const)('创建或写入的 %s 阶段失败时提示候选名称，保留原因和既有文件', async (stage) => {
  const { runner, files, cause, abort } = setup(stage)
  const result = await runner.start()
  expect(result.status).toBe('failed')
  if (result.status !== 'failed')
    throw new Error('未返回失败结果')
  expect(result.error).toBeInstanceOf(Error)
  expect(result.error).toMatchObject({ cause })
  expect(runner.error.value).toContain('目录写入权限已失效')
  expect(runner.error.value).toContain('凭证.txt')
  expect(runner.error.value).toContain('可能')
  expect(runner.error.value).toContain('请先核对后重试')
  expect(files.get('凭证.txt')).toEqual(new Uint8Array())
  expect(files.get('已有资料.txt')).toEqual(new TextEncoder().encode('既有资料'))
  expect(abort).toHaveBeenCalledTimes(stage === 'write' || stage === 'close' ? 1 : 0)
})

it('终止写入流失败时仍提示未完成文件并保留原始写入原因', async () => {
  const { runner, files, cause, abort } = setup('write', true)
  const result = await runner.start()
  expect(result.status).toBe('failed')
  if (result.status !== 'failed')
    throw new Error('未返回失败结果')
  expect(result.error).toMatchObject({ cause })
  expect(runner.error.value).toMatch(/凭证\.txt.*可能.*未完成文件/)
  expect(abort).toHaveBeenCalledOnce()
  expect(files.get('凭证.txt')).toEqual(new Uint8Array())
  expect(files.get('已有资料.txt')).toEqual(new TextEncoder().encode('既有资料'))
})

it('已存在同名文件时提示实际候选后缀，不覆盖已有正文', async () => {
  const { runner, files } = setup('open', false, true)
  expect(await runner.start()).toMatchObject({ status: 'failed' })
  expect(runner.error.value).toContain('凭证 (2).txt')
  expect(files.get('凭证.txt')).toEqual(new TextEncoder().encode('已有同名资料'))
  expect(files.get('凭证 (2).txt')).toEqual(new Uint8Array())
  expect(await runner.retry()).toEqual({ status: 'exported', displayPath: '合成目录' })
  expect(files.get('凭证.txt')).toEqual(new TextEncoder().encode('已有同名资料'))
  expect(files.get('凭证 (2).txt')).toEqual(new Uint8Array())
  expect(files.get('凭证 (3).txt')).toEqual(new TextEncoder().encode('完整合成正文'))
})
