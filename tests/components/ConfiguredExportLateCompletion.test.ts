import type { MaybeRefOrGetter } from 'vue'
import type { ConfiguredExportSettings, ConfiguredExportSource } from '~/lib/kit/export'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { computed, defineComponent, onUnmounted, shallowRef } from 'vue'
import { useConfiguredExportRunner } from '~/composables/useConfiguredExportRunner'
import ExportConfigPage from '~/pages/export/config/[jobId].vue'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function mountPage(writeFile: (path: string, bytes: Uint8Array) => Promise<void>) {
  const close = vi.fn()
  const remove = vi.fn()
  const success = vi.fn()
  const replace = vi.fn(async () => {})
  const route = { fullPath: '/export/config/synthetic-job', params: { jobId: 'synthetic-job' } }
  const source = { label: '合成导出', fields: [{ key: 'name', label: '名称' }], files: [
    { row: { name: '第一份' }, data: '合成正文一' },
    { row: { name: '第二份' }, data: '合成正文二' },
  ] }
  const target = { displayPath: '合成目录', supportsSubdirectories: true, writeFile }
  const globals = {
    computed,
    shallowRef,
    onUnmounted,
    useRoute: () => route,
    useRouter: () => ({ currentRoute: shallowRef(route), replace }),
    useTabsStore: () => ({ close, activeFullPath: '/project' }),
    useExportWorkflowsStore: () => ({ get: () => ({ source, structure: { levels: [] }, naming: { parts: [{ field: 'name' }], extension: 'txt' } }), remove }),
    useToast: () => ({ success }),
    useTabTitle: () => {},
    useConfiguredExportRunner: (exportSource: MaybeRefOrGetter<ConfiguredExportSource>, settings: MaybeRefOrGetter<ConfiguredExportSettings>) => useConfiguredExportRunner(exportSource, settings, { pickDirectory: async () => target, yieldToView: async () => {} }),
  }
  for (const [key, value] of Object.entries(globals)) vi.stubGlobal(key, value)
  const Empty = defineComponent({ template: '<div />' })
  const KitButton = defineComponent({ props: ['disabled', 'loading'], emits: ['click'], template: '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot/></button>' })
  const wrapper = mount(ExportConfigPage, { global: { components: { ExportConfigForm: Empty, ProcessStepper: Empty, KitButton } } })
  return { wrapper, close, remove, success, replace }
}

it('导出写入在途时关闭页签，迟到结果不得再提示或关闭页签', async () => {
  const gate = deferred()
  const started = deferred()
  const files = new Map<string, string>()
  const writeFile = vi.fn(async (path: string, bytes: Uint8Array) => {
    started.resolve()
    await gate.promise
    files.set(path, new TextDecoder().decode(bytes))
  })
  const { wrapper, close, remove, success, replace } = mountPage(writeFile)
  await wrapper.findAll('button').find(button => button.text().includes('开始导出'))!.trigger('click')
  await started.promise
  wrapper.unmount()
  expect(remove).toHaveBeenCalledExactlyOnceWith('synthetic-job')
  gate.resolve()
  await flushPromises()
  expect([...files.values()]).toEqual(['合成正文一', '合成正文二'])
  expect({ success: success.mock.calls, close: close.mock.calls, replace: replace.mock.calls, remove: remove.mock.calls }).toEqual({ success: [], close: [], replace: [], remove: [['synthetic-job']] })
})

it('页面仍在时失败后重试只补写未完成文件并正常通知', async () => {
  const files = new Map<string, string>()
  let failed = false
  const writeFile = vi.fn(async (path: string, bytes: Uint8Array) => {
    if (path.includes('第二份') && !failed) {
      failed = true
      throw new Error('合成写入失败')
    }
    files.set(path, new TextDecoder().decode(bytes))
  })
  const { wrapper, close, success } = mountPage(writeFile)
  await wrapper.findAll('button').find(button => button.text().includes('开始导出'))!.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('合成写入失败')
  expect([...files.values()]).toEqual(['合成正文一'])
  await wrapper.findAll('button').find(button => button.text().includes('重试失败步骤'))!.trigger('click')
  await flushPromises()
  expect([...files.values()]).toEqual(['合成正文一', '合成正文二'])
  expect(writeFile.mock.calls.filter(([path]) => path.includes('第一份'))).toHaveLength(1)
  expect(success).toHaveBeenCalledExactlyOnceWith('已导出到 合成目录 文件夹')
  expect(close).toHaveBeenCalledExactlyOnceWith('/export/config/synthetic-job')
  wrapper.unmount()
})
