import { useObjectUrl } from '@vueuse/core'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import * as Vue from 'vue'
import DeliveryDocumentFields from '~/components/delivery/DeliveryDocumentFields.vue'
import { useDeliveryRecognitionWorkspace } from '~/composables/useDeliveryRecognitionWorkspace'

afterEach(() => vi.unstubAllGlobals())

it('分离的工地与文件名不误选项目，完整命中和人工选择仍可使用', async () => {
  const document = { id: 'document-one', supplierText: '合成分供方', deliveryDate: '2026-01-01', orderNo: 'SYN-1', siteText: '北门', docType: '送货单', items: [{ id: 'line-one', name: '电线', spec: '', unit: '米', qty: 1, unitPrice: 1, amount: 1, amountSource: 'ocr', note: '' }], statedTotal: 1, calculatedTotal: 1, balanced: true, note: '', quality: 'normal' }
  const file = { id: 'file-one', name: '东区项目送货单.pdf', kind: 'pdf', size: 10, supplierText: '合成分供方', docs: [document], ocrStatus: 'done', ocrError: '', rawText: '', engine: '', model: '', preprocessed: false, sourceHash: 'synthetic', intakeDecision: 'material', intakeReason: '', printBatchId: 'batch-one', archivedRecordIds: [], printDisposition: null }
  const delivery = Vue.reactive({ files: [file], duplicates: [], byId: (id: string) => delivery.files.find(row => row.id === id), loadPendingPrintQueue: vi.fn().mockResolvedValue(undefined) })
  const central = Vue.reactive({ origin: 'real', canWrite: true, load: vi.fn().mockResolvedValue(undefined), context: { projects: [{ id: 'project-one', name: '北门东区', dataOrigin: 'real' }], suppliers: [{ id: 'supplier-one', name: '合成分供方', dataOrigin: 'real', aliases: [] }] }, list: [] })
  const globals = { computed: Vue.computed, shallowRef: Vue.shallowRef, shallowReactive: Vue.shallowReactive, watch: Vue.watch, onMounted: Vue.onMounted, onBeforeUnmount: Vue.onBeforeUnmount, onScopeDispose: Vue.onScopeDispose, useObjectUrl, useDeliveryStore: () => delivery, useDeliveryRecordStore: () => central, useSupplierCommandStore: () => ({}), useKitUI: () => ({ confirm: vi.fn(), warning: vi.fn(), promise: (task: Promise<unknown>) => task }), useFileDialog: () => ({ open: vi.fn(), onChange: vi.fn() }), useDropZone: () => ({ isOverDropZone: Vue.shallowRef(false) }) }
  for (const [key, value] of Object.entries(globals)) vi.stubGlobal(key, value)
  let workspace!: ReturnType<typeof useDeliveryRecognitionWorkspace>
  await render(Vue.defineComponent({ setup() {
    workspace = useDeliveryRecognitionWorkspace(Vue.shallowRef(null))
    return () => workspace.reviewDraft.value && workspace.selectedFile.value && workspace.selectedDocument.value
      ? Vue.h(DeliveryDocumentFields, { draft: workspace.reviewDraft.value, file: workspace.selectedFile.value, document: workspace.selectedDocument.value, projects: workspace.projects.value, suppliers: workspace.suppliers.value, supplierSuggestion: workspace.supplierSuggestion.value, onPatch: workspace.patchDraft })
      : null
  } }))
  await expect.poll(() => workspace.reviewDraft.value?.projectId).toBe('')
  expect(workspace.canArchive.value).toBe(false)
  const select = window.document.querySelector<HTMLSelectElement>('select')!
  expect(select.value).toBe('')
  select.value = 'project-one'
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await expect.poll(() => workspace.reviewDraft.value?.projectId).toBe('project-one')
  workspace.patchDraft({ projectId: '' })
  delivery.files[0]!.docs[0]!.siteText = '北门东区'
  await expect.poll(() => workspace.reviewDraft.value?.projectId).toBe('project-one')
  expect(select.value).toBe('project-one')
})
