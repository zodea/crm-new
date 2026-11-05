import type { Component } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { computed, defineComponent, h, onUnmounted, shallowRef } from 'vue'
import ExportConfigForm from '~/components/export/ExportConfigForm.vue'
import ToastHost from '~/components/shared/ToastHost.vue'
import KitButton from '~/components/ui/KitButton.vue'
import ProcessStepper from '~/components/ui/ProcessStepper.vue'
import { useConfiguredExportRunner } from '~/composables/useConfiguredExportRunner'
import { useToast } from '~/composables/useToast'
import ExportConfigPage from '~/pages/export/config/[jobId].vue'

afterEach(() => vi.unstubAllGlobals())

it('目录创建后失败的页面提示候选文件，键盘重试并保留空文件', async ({ task }) => {
  const width = Number(task.file.projectName?.replace('chromium-', ''))
  expect([390, 1280]).toContain(width)
  expect(window.innerWidth).toBe(width)
  const files = new Map<string, Uint8Array>([['已有.txt', new TextEncoder().encode('已有资料')]])
  let first = true
  const directory = {
    name: '合成目录',
    async isSameEntry(other: unknown) { return other === directory },
    async getDirectoryHandle() { return directory },
    async getFileHandle(name: string, options: { create: boolean }) {
      if (!files.has(name)) {
        if (!options.create)
          throw Object.assign(new Error('不存在'), { name: 'NotFoundError' })
        files.set(name, new Uint8Array())
      }
      return {
        async createWritable() {
          if (first) {
            first = false
            throw Object.assign(new Error('合成权限失效'), { name: 'NotAllowedError' })
          }
          let pending = new Uint8Array()
          return {
            async write(data: Uint8Array) { pending = Uint8Array.from(data) },
            async close() { files.set(name, pending) },
          }
        },
      }
    },
  }
  const close = vi.fn()
  const route = { fullPath: '/export/config/synthetic-job', params: { jobId: 'synthetic-job' } }
  const source = { label: '合成导出', fields: [{ key: 'name', label: '名称' }], files: [{ row: { name: '凭证' }, data: '完整合成正文' }] }
  for (const [key, value] of Object.entries({
    showDirectoryPicker: vi.fn().mockResolvedValue(directory),
    computed,
    onUnmounted,
    shallowRef,
    useConfiguredExportRunner,
    useToast,
    useRoute: () => route,
    useRouter: () => ({ currentRoute: shallowRef(route), replace: vi.fn(async () => {}) }),
    useTabsStore: () => ({ close, activeFullPath: '/project' }),
    useExportWorkflowsStore: () => ({ get: () => ({ source, structure: { levels: [] }, naming: { parts: [{ field: 'name' }], extension: 'txt' } }), remove: vi.fn() }),
    useTabTitle: () => {},
  })) vi.stubGlobal(key, value)
  const components: Record<string, Component> = { ExportConfigForm, KitButton, ProcessStepper }
  const Root = defineComponent({ setup: () => () => h('div', [h(ToastHost), h(ExportConfigPage)]) })
  await render(Root, { global: { components } })
  const start = page.getByRole('button', { name: '开始导出' }).element() as HTMLButtonElement
  start.focus()
  expect(document.activeElement).toBe(start)
  await userEvent.keyboard('{Enter}')
  const alert = page.getByRole('alert')
  await expect.element(alert).toHaveTextContent('合成权限失效')
  await expect.element(alert).toHaveTextContent('凭证.txt')
  await expect.element(alert).toHaveTextContent('可能留下空文件或未完成文件')
  await expect.element(alert).toHaveTextContent('请先核对后重试')
  expect(files.get('凭证.txt')).toEqual(new Uint8Array())
  expect(files.get('已有.txt')).toEqual(new TextEncoder().encode('已有资料'))
  const alertElement = alert.element() as HTMLElement
  expect(alertElement.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  const retry = page.getByRole('button', { name: '重试失败步骤' }).element() as HTMLButtonElement
  retry.focus()
  expect(document.activeElement).toBe(retry)
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('已导出到 合成目录 文件夹')).toBeVisible()
  expect(close).toHaveBeenCalledExactlyOnceWith('/export/config/synthetic-job')
  expect(files.get('凭证.txt')).toEqual(new Uint8Array())
  expect(files.get('凭证 (2).txt')).toEqual(new TextEncoder().encode('完整合成正文'))
  expect(files.get('已有.txt')).toEqual(new TextEncoder().encode('已有资料'))
})
