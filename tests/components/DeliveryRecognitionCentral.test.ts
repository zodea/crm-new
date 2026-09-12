import type { DeliveryFile } from '~/stores/delivery'
import { flushPromises, mount } from '@vue/test-utils'
import { useObjectUrl } from '@vueuse/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, onBeforeUnmount, onMounted, onScopeDispose, reactive, shallowReactive, shallowRef, watch } from 'vue'
import { useDeliveryRecognitionWorkspace } from '~/composables/useDeliveryRecognitionWorkspace'

function setup() {
  const files: DeliveryFile[] = [{ id: 'upload', name: '完整原件.pdf', kind: 'pdf', size: 50, supplierText: 'OCR 新抬头', docs: [{ id: 'document', supplierText: 'OCR 新抬头', deliveryDate: '2026-09-11', orderNo: 'DH', siteText: '工地北门', docType: '送货单', items: [{ id: 'line', name: '材料', spec: '', unit: '吨', qty: 1, unitPrice: 10, amount: 10, amountSource: 'ocr', note: '' }], statedTotal: 10, calculatedTotal: 10, balanced: true, note: '', quality: 'normal' }], ocrStatus: 'done', ocrError: '', rawText: '', engine: '', model: '', preprocessed: false, sourceHash: 'hash', intakeDecision: 'material', intakeReason: '', printBatchId: 'batch', archivedRecordIds: [], printDisposition: null }]
  const sequence: string[] = []
  const archiveDocument = vi.fn(async () => {
    sequence.push('archive')
    return 'saved-record'
  })
  const delivery = reactive({ files, duplicates: [], byId: (id: string) => delivery.files.find(file => file.id === id), loadPendingPrintQueue: vi.fn().mockResolvedValue(undefined), loadFileForPrint: vi.fn().mockResolvedValue(new File(['%PDF-1.7\noriginal'], '原件.pdf', { type: 'application/pdf' })), confirmFilePrintReceipt: vi.fn().mockResolvedValue(undefined), excludeFileFromPrint: vi.fn().mockResolvedValue(undefined), archiveDocument })
  const central = reactive({ mode: 'central', origin: 'real', canWrite: true, load: vi.fn().mockResolvedValue(undefined), context: { projects: [{ id: 'p', name: '中央项目', dataOrigin: 'real' }], suppliers: [{ id: 's', name: '中央分供方', dataOrigin: 'real', aliases: [] }] }, list: [] })
  const commands = { createSession: vi.fn(() => ({})), hydrate: vi.fn(async (_session, id: string) => ({ draft: { id, name: '中央分供方', aliases: [] } })), saveForm: vi.fn(async () => {
    sequence.push('alias')
    return { id: 's' }
  }) }
  const confirm = vi.fn().mockResolvedValue(true)
  const warning = vi.fn()
  const local = vi.fn(() => ({ list: [], load: vi.fn(), remember: vi.fn(), byId: vi.fn() }))
  for (const [key, value] of Object.entries({ computed, shallowRef, shallowReactive, watch, onMounted, onBeforeUnmount, onScopeDispose, useObjectUrl, useDeliveryStore: () => delivery, useDeliveryRecordStore: () => central, useSupplierCommandStore: () => commands, useProjectStore: local, useProjectAliasStore: local, useSupplierStore: local, useKitUI: () => ({ confirm, warning, promise: (task: Promise<unknown>) => task }), useFileDialog: () => ({ open: vi.fn(), onChange: vi.fn() }), useDropZone: () => ({ isOverDropZone: shallowRef(false) }) })) vi.stubGlobal(key, value)
  let api!: ReturnType<typeof useDeliveryRecognitionWorkspace>
  const view = mount(defineComponent({ setup() {
    api = useDeliveryRecognitionWorkspace(shallowRef(null))
    return () => h('div')
  } }))
  return { view, api, central, delivery, commands, confirm, warning, sequence, local, archiveDocument }
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('识别送货人工归档与别名的独立结果', () => {
  it('缺必填事实不开放归档，只有待人工质量确认时允许进入确认', async () => {
    const { api, delivery, view } = setup()
    await flushPromises()
    api.patchDraft({ projectId: '', supplierId: null })
    expect(api.canArchive.value).toBe(false)
    api.patchDraft({ projectId: 'p', supplierId: 's' })
    delivery.files[0]!.docs[0]!.quality = 'handwritten'
    expect(api.reviewIssues.value.some(issue => issue.key === 'quality')).toBe(true)
    expect(api.canArchive.value).toBe(true)
    view.unmount()
  })
  it('打印在点击时先打开空白窗口，慢原件返回前切换来源会关闭窗口并取消迟到结果', async () => {
    const { api, central, delivery, warning, view } = setup()
    await flushPromises()
    const printWindow = { opener: {}, closed: false, close: vi.fn(), location: { href: '' }, addEventListener: vi.fn(), focus: vi.fn(), print: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(printWindow as unknown as Window)
    let finish!: (file: File) => void
    delivery.loadFileForPrint.mockImplementationOnce(() => new Promise<File>((resolve) => {
      finish = resolve
    }))
    const pending = api.openPrint('upload')
    expect(open).toHaveBeenCalledWith('about:blank', '_blank')
    expect(printWindow.opener).toBeNull()
    central.origin = 'demo'
    expect(printWindow.close).toHaveBeenCalledTimes(1)
    expect(delivery.loadFileForPrint.mock.calls[0]?.[1]?.signal.aborted).toBe(true)
    finish(new File(['%PDF-1.7\nold'], '旧来源.pdf'))
    await pending
    expect(printWindow.location.href).toBe('')
    expect(warning).not.toHaveBeenCalled()
    view.unmount()
  })

  it('已归档原件再次选择也重新验权，读取失败即撤掉先前预览', async () => {
    const { api, delivery, warning, view } = setup()
    await flushPromises()
    delivery.files[0]!.printDisposition = 'pending'
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:original')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    await api.selectFile('upload')
    await flushPromises()
    expect(api.previewUrl.value).toBe('blob:original')
    delivery.loadFileForPrint.mockRejectedValueOnce(new Error('原件权限已撤销'))
    await api.selectFile('upload')
    await flushPromises()
    expect(delivery.loadFileForPrint).toHaveBeenCalledTimes(2)
    expect(api.previewUrl.value).toBeUndefined()
    expect(warning).toHaveBeenCalledWith('原件权限已撤销')
    view.unmount()
  })

  it('打印回执等待确认时禁止重复操作，来源变更后旧确认不得提交', async () => {
    const { api, central, delivery, confirm, view } = setup()
    await flushPromises()
    let accept!: (answer: boolean) => void
    confirm.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      accept = resolve
    }))
    const pending = api.confirmPrint('upload')
    await api.excludePrint('upload')
    expect(confirm).toHaveBeenCalledTimes(1)
    central.origin = 'demo'
    accept(true)
    await pending
    expect(delivery.confirmFilePrintReceipt).not.toHaveBeenCalled()
    expect(delivery.excludeFileFromPrint).not.toHaveBeenCalled()
    view.unmount()
  })

  it('归档失败保留草稿且不提前修改别名，归档成功后再独立记忆原抬头', async () => {
    const { api, archiveDocument, commands, sequence, local, view } = setup()
    await flushPromises()
    api.patchDraft({ projectId: 'p', supplierId: 's' })
    archiveDocument.mockRejectedValueOnce(new Error('归档版本冲突'))
    await api.archiveSelected()
    expect(commands.hydrate).not.toHaveBeenCalled()
    expect(api.reviewDraft.value?.projectId).toBe('p')
    await api.archiveSelected()
    expect(sequence).toEqual(['archive', 'alias'])
    expect(commands.saveForm.mock.calls[0]?.[1]).toMatchObject({ id: 's', aliases: ['OCR 新抬头'] })
    expect(local).not.toHaveBeenCalled()
    view.unmount()
  })

  it('别名失败单独保留重试身份，重试不重复归档或使用后来文件的抬头', async () => {
    const { api, archiveDocument, commands, delivery, warning, view } = setup()
    await flushPromises()
    api.patchDraft({ projectId: 'p', supplierId: 's' })
    commands.saveForm.mockRejectedValueOnce(new Error('别名保存失败'))
    await api.archiveSelected()
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('送货归档结果不受影响'))
    expect(api.aliasRetry.value).toMatchObject({ supplierId: 's', raw: 'OCR 新抬头' })
    delivery.files[0]!.docs[0]!.supplierText = '另一文件抬头'
    await api.retrySupplierAlias()
    expect(archiveDocument).toHaveBeenCalledTimes(1)
    expect(commands.saveForm.mock.calls[1]?.[1]).toMatchObject({ id: 's', aliases: ['OCR 新抬头'] })
    expect(api.aliasRetry.value).toBeNull()
    view.unmount()
  })

  it('另一张送货归档后仍保留前一笔失败别名，逐笔重试不覆盖且切换来源可恢复', async () => {
    const { api, commands, delivery, central, view } = setup()
    await flushPromises()
    api.patchDraft({ projectId: 'p', supplierId: 's' })
    commands.saveForm.mockRejectedValue(new Error('别名暂不可用'))
    await api.archiveSelected()
    delivery.files[0]!.docs[0]!.supplierText = '第二抬头'
    await api.archiveSelected()
    expect(api.aliasRetry.value?.raw).toBe('OCR 新抬头')
    central.origin = 'demo'
    expect(api.aliasRetry.value).toBeNull()
    central.origin = 'real'
    await flushPromises()
    commands.saveForm.mockResolvedValue({ id: 's' })
    await api.retrySupplierAlias()
    expect(api.aliasRetry.value?.raw).toBe('第二抬头')
    await api.retrySupplierAlias()
    expect(api.aliasRetry.value).toBeNull()
    view.unmount()
  })

  it('人工确认等待中再次触发归档不打开第二次确认或重复提交', async () => {
    const { api, archiveDocument, confirm, view } = setup()
    await flushPromises()
    api.patchDraft({ projectId: 'p', supplierId: 's' })
    let accept!: (answer: boolean) => void
    confirm.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      accept = resolve
    }))
    const first = api.archiveSelected()
    await api.archiveSelected()
    expect(confirm).toHaveBeenCalledTimes(1)
    accept(true)
    await first
    expect(archiveDocument).toHaveBeenCalledTimes(1)
    view.unmount()
  })
})
