import type { Component } from 'vue'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { computed, defineComponent, h, onUnmounted, ref, shallowRef } from 'vue'
import { useImportRunner } from '~/composables/useImportRunner'
import ImportMappingPage from '~/pages/import/mapping/[entity].vue'

const fixture = vi.hoisted(() => ({ sink: vi.fn() }))
vi.mock('~/lib/kit/import-entities', () => ({ getImportEntity: () => ({ key: 'synthetic', label: '合成资料', fields: [{ key: 'name', label: '名称', required: true }], importRow: fixture.sink }) }))

it('相同路径关闭重开后，在途末行完成不会提示或关闭新页', async () => {
  expect(window.innerWidth).toBe(Number(import.meta.env.VITE_IMPORT_VIEW_WIDTH))
  let release!: () => void
  let started!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const reached = new Promise<void>((resolve) => {
    started = resolve
  })
  const writes: string[] = []
  fixture.sink.mockImplementation(async (row: Record<string, unknown>) => {
    started()
    await gate
    writes.push(String(row.name))
  })
  const close = vi.fn()
  const success = vi.fn()
  const warning = vi.fn()
  const replace = vi.fn()
  const route = { fullPath: '/import/mapping/synthetic', params: { entity: 'synthetic' } }
  for (const [key, value] of Object.entries({ computed, shallowRef, onUnmounted, useRoute: () => route, useRouter: () => ({ currentRoute: shallowRef(route), replace }), useRuntimeConfig: () => ({ app: { baseURL: '/' } }), useTabsStore: () => ({ close, activeFullPath: '/project' }), useToast: () => ({ success, warning }), useKitUI: () => ({ exportFile: vi.fn() }), useInvoiceStore: () => ({ list: [] }), useImportRunner: () => useImportRunner({ yieldToView: async () => {} }), useTabTitle: () => {} })) vi.stubGlobal(key, value)
  const Upload = defineComponent({ emits: ['loaded'], template: '<button @click="$emit(\'loaded\', {name: \'合成\', headerRow: 0, range: \'A1:A2\', mergeRanges: [], formulaCount: 0, columns: [\'名称\'], rows: [{名称: \'合成末行\'}]})">载入合成行</button>' })
  const Empty = defineComponent({ template: '<div />' })
  const KitButton = defineComponent({ props: ['disabled', 'loading'], emits: ['click'], template: '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot/></button>' })
  const components: Record<string, Component> = { ImportUploadStep: Upload, ImportMappingStep: Empty, ImportPreviewStep: Empty, ProcessStepper: Empty, ProgressBar: Empty, KitButton, MaterialExcelImportScreen: Empty, ProjectImportScreen: Empty, InvoiceWorkbookUploadStep: Empty, SupplierImportReview: Empty, CrewExcelReview: Empty, WorkerExcelReview: Empty }
  const Shell = defineComponent({
    setup() {
      const visible = ref(true)
      function toggle() {
        visible.value = !visible.value
      }
      return () => h('div', [h('button', { onClick: toggle }, visible.value ? '关闭合成页' : '重开合成页'), visible.value ? h(ImportMappingPage) : null])
    },
  })
  try {
    await render(Shell, { global: { components } })
    await page.getByRole('button', { name: '载入合成行' }).click()
    await page.getByRole('button', { name: '下一步' }).click()
    await page.getByRole('button', { name: '开始导入' }).click()
    await reached
    ;(page.getByRole('button', { name: '关闭合成页' }).element() as HTMLButtonElement).focus()
    await userEvent.keyboard('{Enter}')
    ;(page.getByRole('button', { name: '重开合成页' }).element() as HTMLButtonElement).focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByRole('button', { name: '载入合成行' })).toBeVisible()
    release()
    await expect.poll(() => writes.length).toBe(1)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(writes).toEqual(['合成末行'])
    expect({ success: success.mock.calls, warning: warning.mock.calls, close: close.mock.calls, replace: replace.mock.calls }).toEqual({ success: [], warning: [], close: [], replace: [] })
    await expect.element(page.getByRole('button', { name: '载入合成行' })).toBeVisible()
  }
  finally {
    release()
    vi.unstubAllGlobals()
  }
})
