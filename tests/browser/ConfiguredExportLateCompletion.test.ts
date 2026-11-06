import type { Component, MaybeRefOrGetter } from 'vue'
import type { ConfiguredExportSettings, ConfiguredExportSource } from '~/lib/kit/export'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { computed, defineComponent, h, onUnmounted, ref, shallowRef } from 'vue'
import ExportConfigForm from '~/components/export/ExportConfigForm.vue'
import KitButton from '~/components/ui/KitButton.vue'
import ProcessStepper from '~/components/ui/ProcessStepper.vue'
import { useConfiguredExportRunner } from '~/composables/useConfiguredExportRunner'
import ExportConfigPage from '~/pages/export/config/[jobId].vue'

afterEach(() => vi.unstubAllGlobals())

it('关闭导出页后写入仍完成，旧页不再提示或关闭页签', async ({ task }) => {
  const width = Number(task.file.projectName?.replace('chromium-', ''))
  expect([390, 1280]).toContain(width)
  expect(window.innerWidth).toBe(width)
  let release!: () => void
  let started!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const reached = new Promise<void>((resolve) => {
    started = resolve
  })
  const files = new Map<string, string>()
  const target = {
    displayPath: '合成目录',
    supportsSubdirectories: true,
    async writeFile(path: string, bytes: Uint8Array) {
      started()
      await gate
      files.set(path, new TextDecoder().decode(bytes))
    },
  }
  const close = vi.fn()
  const remove = vi.fn()
  const success = vi.fn()
  const replace = vi.fn(async () => {})
  const route = { fullPath: '/export/config/synthetic-job', params: { jobId: 'synthetic-job' } }
  const source = { label: '合成导出', fields: [{ key: 'name', label: '名称' }], files: [
    { row: { name: '第一份' }, data: '合成正文一' },
    { row: { name: '第二份' }, data: '合成正文二' },
  ] }
  for (const [key, value] of Object.entries({
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
  })) vi.stubGlobal(key, value)
  const components: Record<string, Component> = { ExportConfigForm, KitButton, ProcessStepper }
  const Root = defineComponent({
    setup() {
      const visible = ref(true)
      function hide() {
        visible.value = false
      }
      return () => h('div', [h('button', { onClick: hide }, '关闭合成页'), visible.value ? h(ExportConfigPage) : null])
    },
  })
  try {
    await render(Root, { global: { components } })
    await page.getByRole('button', { name: '开始导出' }).click()
    await reached
    const closeButton = page.getByRole('button', { name: '关闭合成页' }).element() as HTMLButtonElement
    closeButton.focus()
    await userEvent.keyboard('{Enter}')
    expect(remove).toHaveBeenCalledExactlyOnceWith('synthetic-job')
    release()
    await expect.poll(() => files.size).toBe(2)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect([...files.values()]).toEqual(['合成正文一', '合成正文二'])
    expect({ success: success.mock.calls, close: close.mock.calls, replace: replace.mock.calls, remove: remove.mock.calls }).toEqual({ success: [], close: [], replace: [], remove: [['synthetic-job']] })
  }
  finally {
    release()
  }
})
