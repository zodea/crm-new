import type { Component } from 'vue'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, ref, shallowRef, watch } from 'vue'
import DeliveryArchiveFormPage from '~/components/delivery/DeliveryArchiveFormPage.vue'

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: vi.fn(),
}))

const route = {
  fullPath: '/material/delivery/archive/form/new',
  params: {} as Record<string, string>,
}
const add = vi.fn()
const update = vi.fn()
const confirm = vi.fn()

const LookupSelectStub = defineComponent({
  props: {
    modelValue: { type: String, default: null },
    fetch: { type: Function, required: true },
    recentKey: { type: String, required: true },
    placeholder: { type: String, default: '' },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('button', {
      type: 'button',
      onClick: () => emit('update:modelValue', props.recentKey.includes('project') ? 'p1' : 's1'),
    }, props.recentKey.includes('project') ? '选择项目' : '选择分供方')
  },
})

const DeliveryArchiveLineGridStub = defineComponent({
  props: {
    lines: { type: Array, required: true },
  },
  emits: ['update'],
  setup(_props, { emit }) {
    const line = (pendingPrice: boolean) => ({
      key: 'line-1',
      materialName: '水泥',
      spec: 'P.O 42.5',
      unit: '吨',
      qty: 1,
      unitPrice: pendingPrice ? null : 400,
      amount: pendingPrice ? null : 400,
      amountSource: 'manual',
      note: '',
    })
    return () => h('section', [
      h('button', {
        type: 'button',
        onClick: () => emit('update', [line(true)]),
      }, '填写待补价材料'),
      h('button', {
        type: 'button',
        onClick: () => emit('update', [line(false)]),
      }, '填写完整材料'),
    ])
  },
})

const FormFooterStub = defineComponent({
  props: {
    modelValue: { type: Boolean, default: true },
    actions: { type: Array, default: () => [] },
    labels: { type: Object, default: () => ({}) },
    dirty: { type: Boolean, default: false },
    closeAfterSave: { type: Boolean, default: false },
    loadingAction: { type: String, default: null },
  },
  emits: ['action', 'update:modelValue'],
  setup(_props, { emit }) {
    return () => h('button', {
      type: 'button',
      onClick: () => emit('action', 'save'),
    }, '保存送货单')
  },
})

const EmptyStub = defineComponent({
  setup: () => () => h('div'),
})

const globalComponents: Record<string, Component> = {
  DeliveryArchiveLineGrid: DeliveryArchiveLineGridStub,
  DeliveryRecordSourcePanel: EmptyStub,
  FormFooter: FormFooterStub,
  LookupSelect: LookupSelectStub,
  NuxtLink: EmptyStub,
  SectionHeader: EmptyStub,
}

async function prepareDraft(options: { orderNo: string, pendingPrice: boolean }) {
  render(DeliveryArchiveFormPage, {
    global: { components: globalComponents },
  })
  await flushPromises()
  await fireEvent.click(screen.getByRole('button', { name: '选择项目' }))
  await fireEvent.update(screen.getByRole('textbox', { name: '送货单号' }), options.orderNo)
  await fireEvent.click(screen.getByRole('button', {
    name: options.pendingPrice ? '填写待补价材料' : '填写完整材料',
  }))
}

describe('送货单手工归档确认门禁', () => {
  beforeEach(() => {
    route.params = {}
    add.mockReset().mockResolvedValue('delivery-new')
    update.mockReset()
    confirm.mockReset()

    vi.stubGlobal('computed', computed)
    vi.stubGlobal('nextTick', nextTick)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('shallowRef', shallowRef)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('useTabTitle', vi.fn())
    vi.stubGlobal('useTabsStore', () => ({ tabs: [], close: vi.fn(), open: vi.fn() }))
    vi.stubGlobal('useMaterialStore', () => ({
      searchProjects: vi.fn().mockResolvedValue([]),
      searchSuppliers: vi.fn().mockResolvedValue([]),
    }))
    vi.stubGlobal('useDeliveryRecordStore', () => ({
      add,
      update,
      load: vi.fn().mockResolvedValue(undefined),
      byId: vi.fn(),
    }))
    vi.stubGlobal('useKitUI', () => ({
      confirm,
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    }))
  })

  it('全角空白单号未确认时停止保存', async () => {
    confirm.mockResolvedValueOnce(false)
    await prepareDraft({ orderNo: '\u3000', pendingPrice: true })

    await fireEvent.click(screen.getByRole('button', { name: '保存送货单' }))
    await flushPromises()

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: '确认原件确实无单号',
    }))
    expect(add).not.toHaveBeenCalled()
  })

  it('价格待补录未确认时停止保存', async () => {
    confirm.mockResolvedValueOnce(false)
    await prepareDraft({ orderNo: 'SH-PRICE-001', pendingPrice: true })

    await fireEvent.click(screen.getByRole('button', { name: '保存送货单' }))
    await flushPromises()

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: '确认按价格待补录归档',
    }))
    expect(add).not.toHaveBeenCalled()
  })

  it('用户逐项确认后把真实确认态交给持久化门禁', async () => {
    confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(true)
    await prepareDraft({ orderNo: '\u3000', pendingPrice: true })

    await fireEvent.click(screen.getByRole('button', { name: '保存送货单' }))
    await flushPromises()

    expect(confirm).toHaveBeenNthCalledWith(1, expect.objectContaining({ title: '确认原件确实无单号' }))
    expect(confirm).toHaveBeenNthCalledWith(2, expect.objectContaining({ title: '确认按价格待补录归档' }))
    expect(add).toHaveBeenCalledWith(expect.objectContaining({
      orderNo: '\u3000',
      confirmations: {
        noOrderNoConfirmed: true,
        pricePendingConfirmed: true,
      },
    }))
  })

  it('单号与价格完整时不伪造人工确认', async () => {
    await prepareDraft({ orderNo: 'SH-COMPLETE-001', pendingPrice: false })

    await fireEvent.click(screen.getByRole('button', { name: '保存送货单' }))
    await flushPromises()

    expect(confirm).not.toHaveBeenCalled()
    expect(add).toHaveBeenCalledWith(expect.objectContaining({
      confirmations: {
        noOrderNoConfirmed: false,
        pricePendingConfirmed: false,
      },
    }))
  })
})
