import type { Component } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { computed, onUnmounted, shallowRef } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'
import ProcessStepper from '~/components/ui/ProcessStepper.vue'
import { useConfiguredExportRunner } from '~/composables/useConfiguredExportRunner'
import ExportConfigPage from '~/pages/export/config/[jobId].vue'
import ExportConfigForm from '~/pages/export/config/_components/ExportConfigForm.vue'

afterEach(() => vi.unstubAllGlobals())

it('同名不同目录重试时，页面不会漏写第一份文件', async () => {
  function directory(failSecond: boolean) {
    const files: string[] = []
    const handle = {
      name: '导出',
      files,
      async isSameEntry(other: unknown) { return other === handle },
      async getDirectoryHandle() { return handle },
      async getFileHandle(name: string, options: { create: boolean }) {
        if (!options.create)
          throw Object.assign(new Error('不存在'), { name: 'NotFoundError' })
        return { createWritable: async () => ({
          write: async () => {
            if (failSecond && name === '乙.txt')
              throw new Error('合成写入失败')
            files.push(name)
          },
          close: async () => {},
        }) }
      },
    }
    return handle
  }
  const first = directory(true)
  const second = directory(false)
  const picker = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
  const success = vi.fn()
  const close = vi.fn()
  const route = { fullPath: '/export/config/synthetic-job', params: { jobId: 'synthetic-job' } }
  const source = { label: '合成导出', fields: [{ key: 'name', label: '名称' }], files: [{ row: { name: '甲' }, data: '第一份' }, { row: { name: '乙' }, data: '第二份' }] }
  for (const [key, value] of Object.entries({
    showDirectoryPicker: picker,
    computed,
    onUnmounted,
    shallowRef,
    useConfiguredExportRunner,
    useRoute: () => route,
    useRouter: () => ({ currentRoute: shallowRef(route), replace: vi.fn(async () => {}) }),
    useTabsStore: () => ({ close, activeFullPath: '/project' }),
    useExportWorkflowsStore: () => ({ get: () => ({ source, naming: { parts: [{ field: 'name' }], extension: 'txt' } }), remove: vi.fn() }),
    useToast: () => ({ success }),
    useTabTitle: () => {},
  })) vi.stubGlobal(key, value)
  const components: Record<string, Component> = { ExportConfigForm, KitButton, ProcessStepper }

  await render(ExportConfigPage, { global: { components } })
  await page.getByRole('button', { name: '开始导出' }).click()
  await expect.element(page.getByRole('alert')).toHaveTextContent('合成写入失败')
  expect(first.files).toEqual(['甲.txt'])
  expect(second.files).toEqual([])
  await page.getByRole('button', { name: '重试失败步骤' }).click()
  await expect.poll(() => success.mock.calls.length).toBe(1)
  expect(second.files).toEqual(['甲.txt', '乙.txt'])
  expect(close).toHaveBeenCalledExactlyOnceWith('/export/config/synthetic-job')
})
