import type { DeliveryRecord } from '~/stores/delivery-record'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, onMounted, reactive, shallowRef, watch } from 'vue'
import DeliveryArchiveScreen from '~/components/delivery/DeliveryArchiveScreen.vue'
import KitButton from '~/components/ui/KitButton.vue'

const createZip = vi.hoisted(() => vi.fn())

vi.mock('~/lib/delivery/export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/delivery/export')>()
  return {
    ...actual,
    createDeliveryArchiveZip: createZip,
  }
})

const record: DeliveryRecord = {
  id: 'delivery-1',
  projectId: 'project-1',
  supplierId: 'supplier-1',
  rawSiteText: '',
  orderNo: 'SH-001',
  deliveryDate: '2026-08-11',
  fileName: '送货单.pdf',
  filePath: '',
  ocrStatus: 'reviewed',
  reviewStatus: 'reviewed',
  naturalKeyDuplicate: false,
  currentValuesConfirmed: true,
  archived: true,
  stored: true,
  printBatchId: 'delivery-1',
  printDisposition: 'pending',
  printedAt: '',
  printExcludedAt: '',
  reviewFlag: '',
  note: '',
  createdAt: '2026-08-11',
  updatedAt: '2026-08-11',
  hasSourceFile: true,
  lines: [{
    id: 'line-1',
    deliveryRecordId: 'delivery-1',
    materialName: '水泥',
    spec: 'P.O 42.5',
    unit: '吨',
    qty: 1,
    unitPrice: 400,
    amount: 400,
    amountSource: 'manual',
    currentValueConfirmed: true,
    note: '',
    sortOrder: 0,
  }],
  totalAmount: 400,
}

const kitUi = {
  confirm: vi.fn(),
  error: vi.fn(),
  exportFile: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  undoToast: vi.fn(),
}

const Passthrough = defineComponent({
  setup(_, { slots }) {
    return () => h('div', slots.default?.())
  },
})

const NuxtLinkStub = defineComponent({
  props: ['to'],
  setup(props, { slots }) {
    return () => h('a', { href: props.to }, slots.default?.())
  },
})

const TableStub = defineComponent({
  props: ['data'],
  setup(props, { slots }) {
    return () => h('div', props.data?.flatMap((row: DeliveryRecord) => ['orderNo', 'project', 'supplier', 'action'].map(key => slots[key]?.({ row }))))
  },
})

const ScopeStub = defineComponent({
  props: ['items'],
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('div', props.items?.flatMap((item: { key: string, children?: Array<{ key: string, label: string }> }) => item.children?.map(child => h('button', { onClick: () => emit('update:modelValue', child.key) }, `筛选${child.label}`)) ?? []))
  },
})

const global = {
  components: {
    KitButton,
    KitTable: TableStub,
    NuxtLink: NuxtLinkStub,
    SearchInput: Passthrough,
    TreeNav: Passthrough,
  },
  stubs: { ArchiveScopePicker: Passthrough },
}

describe('送货单归档库导出', () => {
  beforeEach(() => {
    createZip.mockReset()
    createZip.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      sources: [{ recordId: record.id }],
      missingRecordIds: [record.id],
    })
    for (const method of Object.values(kitUi))
      method.mockReset()
    kitUi.exportFile.mockResolvedValue({ status: 'cancelled' })

    vi.stubGlobal('computed', computed)
    vi.stubGlobal('onMounted', onMounted)
    vi.stubGlobal('shallowRef', shallowRef)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useKitUI', () => kitUi)
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { materialContractRead: { list: vi.fn().mockResolvedValue({ items: [], pagination: { page: 1, pageSize: 100, total: 0 }, sourceVersion: 'v1' }) } } }))
    vi.stubGlobal('useDeliveryRecordStore', () => ({
      list: [record],
      loading: false,
      load: vi.fn().mockResolvedValue(undefined),
      loadSourceFile: vi.fn().mockResolvedValue(null),
      remove: vi.fn(),
      undo: vi.fn(),
    }))
  })

  it('用户取消统一写盘时保持静默，不触发额外成功或缺原件提示', async () => {
    render(DeliveryArchiveScreen, {
      global,
    })

    await flushPromises()
    await waitFor(() => expect(screen.getByRole('button', { name: '导出原件包' }).hasAttribute('disabled')).toBe(false))
    await fireEvent.click(screen.getByRole('button', { name: '导出原件包' }))
    await waitFor(() => expect(kitUi.exportFile).toHaveBeenCalledOnce())

    expect(kitUi.exportFile).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.any(Function),
      defaultName: expect.stringMatching(/^送货单原件包_\d{4}-\d{2}-\d{2}\.zip$/),
      mimeType: 'application/zip',
    }))
    expect(kitUi.success).not.toHaveBeenCalled()
    expect(kitUi.warning).not.toHaveBeenCalled()
    expect(kitUi.error).not.toHaveBeenCalled()
    expect(createZip).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '导出原件包' }).getAttribute('disabled')).toBeNull()
  })

  it('写盘成功后只补充缺原件警告，成功反馈仍由 exportFile 唯一负责', async () => {
    kitUi.exportFile.mockImplementationOnce(async (options) => {
      await options.data()
      return { status: 'exported', displayPath: '下载' }
    })
    render(DeliveryArchiveScreen, {
      global,
    })

    await flushPromises()
    await waitFor(() => expect(screen.getByRole('button', { name: '导出原件包' }).hasAttribute('disabled')).toBe(false))
    await fireEvent.click(screen.getByRole('button', { name: '导出原件包' }))
    await waitFor(() => expect(kitUi.warning).toHaveBeenCalledWith('1 份送货单缺少原件，异常已写入 Excel'))

    expect(kitUi.exportFile).toHaveBeenCalledOnce()
    expect(kitUi.success).not.toHaveBeenCalled()
    expect(kitUi.error).not.toHaveBeenCalled()
  })

  it('中央归档只使用当前关系，带冒号的稳定 ID 可筛选，读取失败撤下旧事实和动作', async () => {
    const central = reactive({ origin: 'real', canWrite: true, loading: false, list: [{ ...record, id: 'd:1', projectId: 'p:1', supplierId: 's:1', dataOrigin: 'real', projectName: '中央项目', supplierName: '中央分供方' }], context: { projects: [{ id: 'p:1', name: '中央项目' }], suppliers: [{ id: 's:1', name: '中央分供方' }], materialContracts: [] }, load: vi.fn().mockResolvedValue(undefined), loadSourceFile: vi.fn(), remove: vi.fn(), undo: vi.fn() })
    vi.stubGlobal('useDeliveryRecordStore', () => central)
    render(DeliveryArchiveScreen, { global: { ...global, stubs: { ArchiveScopePicker: ScopeStub } } })
    await screen.findByText('中央项目')
    await fireEvent.click(screen.getByRole('button', { name: '筛选中央分供方' }))
    expect(screen.getByRole('link', { name: 'SH-001' }).getAttribute('href')).toBe('/material/delivery/archive/d%3A1?origin=real')
    central.load.mockRejectedValueOnce(new Error('关联权限已撤销'))
    await fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await screen.findByRole('alert')
    expect(screen.queryByText('SH-001')).toBeNull()
    expect(screen.queryByRole('link', { name: /新增送货单/ })).toBeNull()
    expect(screen.getByRole('button', { name: '导出原件包' }).hasAttribute('disabled')).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    await screen.findByText('SH-001')
  })

  it('等待目录选择时切换来源，取消当前导出且不再读取迟到原件', async () => {
    const central = reactive({ origin: 'real', canWrite: true, loading: false, list: [record], context: { projects: [], suppliers: [], materialContracts: [] }, load: vi.fn().mockResolvedValue(undefined), loadSourceFile: vi.fn() })
    vi.stubGlobal('useDeliveryRecordStore', () => central)
    let proceed!: () => void
    kitUi.exportFile.mockImplementationOnce(async (options) => {
      await new Promise<void>(resolve => proceed = resolve)
      await options.data()
      return { status: 'exported' }
    })
    render(DeliveryArchiveScreen, { global })
    await waitFor(() => expect(screen.getByRole('button', { name: '导出原件包' }).hasAttribute('disabled')).toBe(false))
    await fireEvent.click(screen.getByRole('button', { name: '导出原件包' }))
    central.origin = 'demo'
    await waitFor(() => expect(kitUi.exportFile.mock.calls[0]![0].signal.aborted).toBe(true))
    proceed()
    await waitFor(() => expect(screen.queryByRole('button', { name: '正在生成…' })).toBeNull())
    expect(createZip).not.toHaveBeenCalled()
    expect(kitUi.error).not.toHaveBeenCalled()
    expect(kitUi.warning).not.toHaveBeenCalled()
  })
})
