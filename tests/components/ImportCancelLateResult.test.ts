import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { computed, defineComponent, onUnmounted, shallowRef } from 'vue'
import { useImportRunner } from '~/composables/useImportRunner'
import ImportMappingPage from '~/pages/import/mapping/[entity].vue'

const fixture = vi.hoisted(() => ({ sink: vi.fn() }))
vi.mock('~/lib/kit/import-entities', () => ({ getImportEntity: () => ({ key: 'synthetic', label: '合成资料', fields: [{ key: 'name', label: '名称', required: true }], importRow: fixture.sink }) }))

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

it('关闭后重开同路径，旧末行完成不能提示成功或关闭新实例', async () => {
  const gate = deferred()
  const started = deferred()
  const writes: string[] = []
  fixture.sink.mockReset().mockImplementation(async (row: Record<string, unknown>) => {
    started.resolve()
    await gate.promise
    writes.push(String(row.name))
  })
  const close = vi.fn()
  const success = vi.fn()
  const warning = vi.fn()
  const route = { fullPath: '/import/mapping/synthetic', params: { entity: 'synthetic' } }
  const replace = vi.fn().mockResolvedValue(undefined)
  const globals = { computed, shallowRef, onUnmounted, useRoute: () => route, useRouter: () => ({ currentRoute: shallowRef(route), replace }), useRuntimeConfig: () => ({ app: { baseURL: '/' } }), useTabsStore: () => ({ close, activeFullPath: '/project' }), useToast: () => ({ success, warning }), useKitUI: () => ({ exportFile: vi.fn() }), useInvoiceStore: () => ({ list: [] }), useImportRunner: () => useImportRunner({ yieldToView: async () => {} }), useTabTitle: () => {} }
  for (const [key, value] of Object.entries(globals)) vi.stubGlobal(key, value)
  const Upload = defineComponent({ emits: ['loaded'], template: '<button @click="$emit(\'loaded\', {name: \'合成\', headerRow: 0, range: \'A1:A2\', mergeRanges: [], formulaCount: 0, columns: [\'名称\'], rows: [{名称: \'合成末行\'}]})">载入合成行</button>' })
  const Empty = defineComponent({ template: '<div />' })
  const KitButton = defineComponent({ props: ['disabled', 'loading'], emits: ['click'], template: '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot/></button>' })
  const components = { ImportUploadStep: Upload, ImportMappingStep: Empty, ImportPreviewStep: Empty, ProcessStepper: Empty, ProgressBar: Empty, KitButton, MaterialExcelImportScreen: Empty, ProjectImportScreen: Empty, InvoiceWorkbookUploadStep: Empty, SupplierImportReview: Empty, CrewExcelReview: Empty, WorkerExcelReview: Empty }
  const oldView = mount(ImportMappingPage, { global: { components } })
  await oldView.findAll('button').find(button => button.text().includes('载入合成行'))!.trigger('click')
  await oldView.findAll('button').find(button => button.text().includes('下一步'))!.trigger('click')
  await oldView.findAll('button').find(button => button.text().includes('开始导入'))!.trigger('click')
  await started.promise
  oldView.unmount()
  const newView = mount(ImportMappingPage, { global: { components } })
  expect(newView.text()).toContain('导入映射')
  gate.resolve()
  await flushPromises()
  expect(writes).toEqual(['合成末行'])
  expect(fixture.sink).toHaveBeenCalledOnce()
  expect({ success: success.mock.calls, warning: warning.mock.calls, close: close.mock.calls, replace: replace.mock.calls }).toEqual({ success: [], warning: [], close: [], replace: [] })
  newView.unmount()
})

it('卸载后执行器迟到返回 completed，页面自身阻止提示和关闭', async () => {
  const gate = deferred()
  const started = deferred()
  const close = vi.fn()
  const success = vi.fn()
  const warning = vi.fn()
  const replace = vi.fn()
  const route = { fullPath: '/import/mapping/synthetic', params: { entity: 'synthetic' } }
  const runner = useImportRunner({ yieldToView: async () => {} })
  runner.start = vi.fn(async () => {
    started.resolve()
    await gate.promise
    return { status: 'completed' as const }
  })
  const globals = { computed, shallowRef, onUnmounted, useRoute: () => route, useRouter: () => ({ currentRoute: shallowRef(route), replace }), useRuntimeConfig: () => ({ app: { baseURL: '/' } }), useTabsStore: () => ({ close, activeFullPath: '/project' }), useToast: () => ({ success, warning }), useKitUI: () => ({ exportFile: vi.fn() }), useInvoiceStore: () => ({ list: [] }), useImportRunner: () => runner, useTabTitle: () => {} }
  for (const [key, value] of Object.entries(globals)) vi.stubGlobal(key, value)
  const Upload = defineComponent({ emits: ['loaded'], template: '<button @click="$emit(\'loaded\', {name: \'合成\', headerRow: 0, range: \'A1:A2\', mergeRanges: [], formulaCount: 0, columns: [\'名称\'], rows: [{名称: \'合成末行\'}]})">载入合成行</button>' })
  const Empty = defineComponent({ template: '<div />' })
  const KitButton = defineComponent({ props: ['disabled', 'loading'], emits: ['click'], template: '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot/></button>' })
  const components = { ImportUploadStep: Upload, ImportMappingStep: Empty, ImportPreviewStep: Empty, ProcessStepper: Empty, ProgressBar: Empty, KitButton, MaterialExcelImportScreen: Empty, ProjectImportScreen: Empty, InvoiceWorkbookUploadStep: Empty, SupplierImportReview: Empty, CrewExcelReview: Empty, WorkerExcelReview: Empty }
  const oldView = mount(ImportMappingPage, { global: { components } })
  await oldView.findAll('button').find(button => button.text().includes('载入合成行'))!.trigger('click')
  await oldView.findAll('button').find(button => button.text().includes('下一步'))!.trigger('click')
  await oldView.findAll('button').find(button => button.text().includes('开始导入'))!.trigger('click')
  await started.promise
  oldView.unmount()
  const newView = mount(ImportMappingPage, { global: { components } })
  gate.resolve()
  await flushPromises()
  expect({ success: success.mock.calls, warning: warning.mock.calls, close: close.mock.calls, replace: replace.mock.calls }).toEqual({ success: [], warning: [], close: [], replace: [] })
  expect(newView.text()).toContain('导入映射')
  newView.unmount()
})

it('预览期间卸载，迟到的恢复结果不再读取目录或继续预览', async () => {
  const gate = deferred()
  const started = deferred()
  const context = vi.fn()
  const route = { fullPath: '/import/mapping/supplier', params: { entity: 'supplier' } }
  const globals = { computed, shallowRef, onUnmounted, useRoute: () => route, useRouter: () => ({ currentRoute: shallowRef(route), replace: vi.fn() }), useRuntimeConfig: () => ({ app: { baseURL: '/' } }), useTabsStore: () => ({ close: vi.fn(), activeFullPath: '/project' }), useToast: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }), useKitUI: () => ({ exportFile: vi.fn() }), useInvoiceStore: () => ({ list: [] }), useImportRunner: () => useImportRunner({ yieldToView: async () => {} }), useTabTitle: () => {}, useSupplierCommandStore: () => ({ recoverPendingImports: async () => {
    started.resolve()
    await gate.promise
    return { applied: 0, notApplied: 0 }
  } }), useNuxtApp: () => ({ $repositories: { supplierCommands: { context } } }) }
  for (const [key, value] of Object.entries(globals)) vi.stubGlobal(key, value)
  const Upload = defineComponent({ emits: ['loaded'], template: '<button @click="$emit(\'loaded\', {name: \'合成\', headerRow: 0, range: \'A1:A2\', mergeRanges: [], formulaCount: 0, columns: [\'名称\'], rows: [{名称: \'合成行\'}]})">载入合成行</button>' })
  const Empty = defineComponent({ template: '<div />' })
  const KitButton = defineComponent({ props: ['disabled', 'loading'], emits: ['click'], template: '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot/></button>' })
  const components = { ImportUploadStep: Upload, ImportMappingStep: Empty, ImportPreviewStep: Empty, ProcessStepper: Empty, ProgressBar: Empty, KitButton, MaterialExcelImportScreen: Empty, ProjectImportScreen: Empty, InvoiceWorkbookUploadStep: Empty, SupplierImportReview: Empty, CrewExcelReview: Empty, WorkerExcelReview: Empty }
  const view = mount(ImportMappingPage, { global: { components } })
  await view.findAll('button').find(button => button.text().includes('载入合成行'))!.trigger('click')
  await view.findAll('button').find(button => button.text().includes('下一步'))!.trigger('click')
  await started.promise
  view.unmount()
  gate.resolve()
  await flushPromises()
  expect(context).not.toHaveBeenCalled()
})
