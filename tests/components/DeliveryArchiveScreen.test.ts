import type { Component } from 'vue'
import type { DeliveryRecord } from '~/stores/delivery-record'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, onMounted, shallowRef, watch } from 'vue'
import DeliveryArchiveScreen from '~/components/delivery/DeliveryArchiveScreen.vue'

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
  setup(_, { slots }) {
    return () => h('a', slots.default?.())
  },
})

const globalComponents: Record<string, Component> = {
  ArchiveScopePicker: Passthrough,
  KitTable: Passthrough,
  NuxtLink: NuxtLinkStub,
  SearchInput: Passthrough,
  TreeNav: Passthrough,
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
    vi.stubGlobal('useDeliveryRecordStore', () => ({
      list: [record],
      loading: false,
      load: vi.fn().mockResolvedValue(undefined),
      loadSourceFile: vi.fn().mockResolvedValue(null),
      remove: vi.fn(),
      undo: vi.fn(),
    }))
    vi.stubGlobal('useProjectStore', () => ({
      list: [{ id: 'project-1', name: '合和新城' }],
      byId: () => ({ id: 'project-1', name: '合和新城' }),
      load: vi.fn().mockResolvedValue(undefined),
    }))
    vi.stubGlobal('useSupplierStore', () => ({
      list: [{ id: 'supplier-1', name: '广州建材有限公司' }],
      byId: () => ({ id: 'supplier-1', name: '广州建材有限公司' }),
      load: vi.fn().mockResolvedValue(undefined),
    }))
    vi.stubGlobal('useContractStore', () => ({
      list: [],
      load: vi.fn().mockResolvedValue(undefined),
    }))
  })

  it('用户取消统一写盘时保持静默，不触发额外成功或缺原件提示', async () => {
    render(DeliveryArchiveScreen, {
      global: { components: globalComponents },
    })

    await fireEvent.click(screen.getByRole('button', { name: '导出原件包' }))
    await waitFor(() => expect(kitUi.exportFile).toHaveBeenCalledOnce())

    expect(kitUi.exportFile).toHaveBeenCalledWith(expect.objectContaining({
      data: new Uint8Array([1, 2, 3]),
      defaultName: expect.stringMatching(/^送货单原件包_\d{4}-\d{2}-\d{2}\.zip$/),
      mimeType: 'application/zip',
    }))
    expect(kitUi.success).not.toHaveBeenCalled()
    expect(kitUi.warning).not.toHaveBeenCalled()
    expect(kitUi.error).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '导出原件包' }).getAttribute('disabled')).toBeNull()
  })

  it('写盘成功后只补充缺原件警告，成功反馈仍由 exportFile 唯一负责', async () => {
    kitUi.exportFile.mockResolvedValueOnce({ status: 'exported', displayPath: '下载' })
    render(DeliveryArchiveScreen, {
      global: { components: globalComponents },
    })

    await fireEvent.click(screen.getByRole('button', { name: '导出原件包' }))
    await waitFor(() => expect(kitUi.warning).toHaveBeenCalledWith('1 份送货单缺少原件，异常已写入 Excel'))

    expect(kitUi.exportFile).toHaveBeenCalledOnce()
    expect(kitUi.success).not.toHaveBeenCalled()
    expect(kitUi.error).not.toHaveBeenCalled()
  })
})
