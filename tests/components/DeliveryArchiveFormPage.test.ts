import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, KeepAlive, nextTick, reactive, ref, shallowRef, watch } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'
import { deliveryProblem } from '~/lib/delivery-record/contract'
import DeliveryArchiveFormPage from '~/pages/material/delivery/archive/form/_components/DeliveryArchiveFormPage.vue'

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
const warning = vi.fn()
const error = vi.fn()
const load = vi.fn()
const byId = vi.fn()
const scope = reactive({ origin: 'real', canWrite: true })

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
      onClick: async () => {
        const matches = await props.fetch('')
        emit('update:modelValue', matches[0]?.id)
      },
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

const global = {
  components: {
    KitButton,
    KitTable: defineComponent({ props: ['data'], setup: props => () => h('div', JSON.stringify(props.data)) }),
    FormFooter: FormFooterStub,
    LookupSelect: LookupSelectStub,
    NuxtLink: EmptyStub,
    SectionHeader: EmptyStub,
  },
  stubs: {
    DeliveryArchiveLineGrid: DeliveryArchiveLineGridStub,
    DeliveryRecordSourcePanel: EmptyStub,
  },
}

async function prepareDraft(options: { orderNo: string, pendingPrice: boolean }) {
  render(DeliveryArchiveFormPage, {
    global,
  })
  await flushPromises()
  await fireEvent.click(screen.getByRole('button', { name: '选择项目' }))
  await fireEvent.click(screen.getByRole('button', { name: '选择分供方' }))
  await fireEvent.update(screen.getByLabelText(/送货日期/), '2026-09-11')
  await fireEvent.update(screen.getByRole('textbox', { name: '送货单号' }), options.orderNo)
  await fireEvent.click(screen.getByRole('button', {
    name: options.pendingPrice ? '填写待补价材料' : '填写完整材料',
  }))
}

describe('送货单手工归档确认门禁', () => {
  beforeEach(() => {
    scope.origin = 'real'
    scope.canWrite = true
    route.params = {}
    add.mockReset().mockResolvedValue('delivery-new')
    update.mockReset()
    confirm.mockReset()
    warning.mockReset()
    error.mockReset()
    load.mockReset().mockResolvedValue(undefined)
    byId.mockReset()

    vi.stubGlobal('computed', computed)
    vi.stubGlobal('nextTick', nextTick)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('shallowRef', shallowRef)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('useTabTitle', vi.fn())
    vi.stubGlobal('useTabsStore', () => ({ registerCloseGuard: () => () => {}, tabs: [], close: vi.fn(), open: vi.fn() }))
    vi.stubGlobal('useDeliveryRecordStore', () => ({
      add,
      update,
      get origin() { return scope.origin },
      get canWrite() { return scope.canWrite },
      context: { projects: [{ id: 'p1', name: '中央项目' }], suppliers: [{ id: 's1', name: '中央分供方' }] },
      load,
      byId,
    }))
    vi.stubGlobal('useKitUI', () => ({
      confirm,
      success: vi.fn(),
      warning,
      error,
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
        amountReviewed: false,
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
        amountReviewed: false,
      },
    }))
  })

  it('载入期间离开后返回会重新读取，不会停在旧请求的加载状态', async () => {
    let finish!: () => void
    load.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finish = resolve
    }))
    const shown = ref(true)
    render(defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => shown.value ? h(DeliveryArchiveFormPage) : h('div', '其他页面') }) }), { global })
    expect(screen.getByText('正在载入送货单…')).toBeTruthy()
    shown.value = false
    await nextTick()
    finish()
    await flushPromises()
    shown.value = true
    await flushPromises()
    expect(load).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('正在载入送货单…')).toBeNull()
    expect(screen.getByRole('button', { name: '选择项目' })).toBeTruthy()
  })

  it('确认等待时不重复打开确认，切换来源后不提交旧人工稿', async () => {
    await prepareDraft({ orderNo: '', pendingPrice: false })
    let accept!: (answer: boolean) => void
    confirm.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      accept = resolve
    }))
    await fireEvent.click(screen.getByRole('button', { name: '保存送货单' }))
    await fireEvent.click(screen.getByRole('button', { name: '保存送货单' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    scope.origin = 'demo'
    accept(true)
    await flushPromises()
    expect(add).not.toHaveBeenCalled()
  })

  it('新归档不默认日期，中央选择器不读取同名本地身份', async () => {
    render(DeliveryArchiveFormPage, { global })
    await flushPromises()
    expect((screen.getByLabelText(/送货日期/) as HTMLInputElement).value).toBe('')
    expect(load).toHaveBeenCalledOnce()
    await fireEvent.click(screen.getByRole('button', { name: '选择项目' }))
    await fireEvent.click(screen.getByRole('button', { name: '选择分供方' }))
    await fireEvent.click(screen.getByRole('button', { name: '填写完整材料' }))
    await fireEvent.update(screen.getByRole('textbox', { name: '送货单号' }), 'CENTRAL-1')
    await fireEvent.click(screen.getByRole('button', { name: '保存送货单' }))
    await flushPromises()
    expect(add).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('日期'))
    await fireEvent.update(screen.getByLabelText(/送货日期/), '2026-09-11')
    await fireEvent.click(screen.getByRole('button', { name: '保存送货单' }))
    await flushPromises()
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', supplierId: 's1' }))
  })

  it('未选择分供方时不提交，即使材料与日期均完整', async () => {
    render(DeliveryArchiveFormPage, { global })
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '选择项目' }))
    await fireEvent.update(screen.getByLabelText(/送货日期/), '2026-09-11')
    await fireEvent.click(screen.getByRole('button', { name: '填写完整材料' }))
    await fireEvent.click(screen.getByRole('button', { name: '保存送货单' }))
    await flushPromises()
    expect(add).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('分供方'))
    expect(confirm).not.toHaveBeenCalled()
  })

  it('编辑保留初始版本、材料行身份与原因，冲突后保留草稿供再次确认', async () => {
    route.params = { id: 'delivery-existing' }
    const current = {
      id: 'delivery-existing',
      version: '3',
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'D-1',
      deliveryDate: '2026-09-10',
      note: '',
      lines: [{ id: 'stable-line', materialName: '砂', spec: '', unit: '吨', qty: 1, unitPrice: 10, amount: 10, amountSource: 'manual', note: '' }],
    }
    byId.mockReturnValue(current)
    render(DeliveryArchiveFormPage, { global })
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '保存送货单' }))
    expect(update).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('原因'))
    await fireEvent.update(screen.getByRole('textbox', { name: /修订原因/ }), '核对日期')
    await fireEvent.update(screen.getByLabelText(/送货日期/), '2026-09-11')
    current.version = '4'
    update.mockRejectedValueOnce(new Error('记录已更新，请重读'))
    confirm.mockResolvedValue(true)
    await fireEvent.click(screen.getByRole('button', { name: '保存送货单' }))
    await flushPromises()
    expect(update).toHaveBeenCalledWith('delivery-existing', expect.objectContaining({ lines: [expect.objectContaining({ id: 'stable-line' })] }), '核对日期', '3')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('记录已更新'))
    expect((screen.getByRole('textbox', { name: /修订原因/ }) as HTMLInputElement).value).toBe('核对日期')
    expect((screen.getByLabelText(/送货日期/) as HTMLInputElement).value).toBe('2026-09-11')
  })

  it('上下文读取失败时不开放新建保存，也不回落本地选择器', async () => {
    load.mockRejectedValue(new Error('没有送货读取权限'))
    render(DeliveryArchiveFormPage, { global })
    await flushPromises()
    expect(screen.getByRole('alert').textContent).toContain('没有送货读取权限')
    expect(screen.queryByRole('button', { name: '保存送货单' })).toBeNull()
  })

  it('版本冲突后可保稿重读当前字段与明细，取消不抬版本，明确核对后才按新版本重试', async () => {
    route.params = { id: 'delivery-existing' }
    const current = { id: 'delivery-existing', version: '3', projectId: 'p1', supplierId: 's1', projectName: '中央项目', supplierName: '中央分供方', orderNo: 'D-1', deliveryDate: '2026-09-10', note: '', lines: [{ id: 'stable-line', materialName: '砂', spec: '', unit: '吨', qty: 1, unitPrice: 10, amount: 10, amountSource: 'manual', note: '' }] }
    byId.mockImplementation(() => current)
    update.mockRejectedValue(deliveryProblem('conflict', '记录已更新，请重新核对'))
    confirm.mockResolvedValue(true)
    render(DeliveryArchiveFormPage, { global })
    await flushPromises()
    await fireEvent.update(screen.getByLabelText(/修订原因/), '保留人工修正')
    await fireEvent.update(screen.getByLabelText(/送货日期/), '2026-09-11')
    await fireEvent.click(screen.getByRole('button', { name: '保存送货单' }))
    await flushPromises()
    Object.assign(current, { version: '4', deliveryDate: '2026-09-09', note: '另一位经办已核实数量', lines: [{ ...current.lines[0]!, materialName: '当前石子', qty: 2, amount: 20 }] })
    await fireEvent.click(screen.getByRole('button', { name: '重新核对当前记录' }))
    await flushPromises()
    const review = screen.getByRole('region', { name: '核对当前送货记录' })
    expect(review.textContent).toContain('2026-09-09')
    expect(review.textContent).toContain('另一位经办已核实数量')
    expect(review.textContent).toContain('当前石子')
    expect((screen.getByLabelText(/送货日期/) as HTMLInputElement).value).toBe('2026-09-11')
    expect((screen.getByLabelText(/修订原因/) as HTMLTextAreaElement).value).toBe('保留人工修正')
    expect(update).toHaveBeenCalledTimes(1)
    confirm.mockResolvedValueOnce(false)
    await fireEvent.click(screen.getByRole('button', { name: '采用已核对的当前版本' }))
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '保存送货单' }))
    await flushPromises()
    expect(update).toHaveBeenLastCalledWith('delivery-existing', expect.anything(), '保留人工修正', '3')
    await fireEvent.click(screen.getByRole('button', { name: '重新核对当前记录' }))
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '采用已核对的当前版本' }))
    await flushPromises()
    expect(update).toHaveBeenCalledTimes(2)
    update.mockResolvedValue('revision-5')
    await fireEvent.click(screen.getByRole('button', { name: '保存送货单' }))
    await flushPromises()
    expect(update).toHaveBeenLastCalledWith('delivery-existing', expect.objectContaining({ deliveryDate: '2026-09-11', lines: [expect.objectContaining({ materialName: '砂', qty: 1 })] }), '保留人工修正', '4')
  })

  it.each(['再次更新', '失去写权限', '离开页面'] as const)('核对确认等待中%s，不采用迟到确认也不更改人工稿', async (change) => {
    route.params = { id: 'delivery-existing' }
    const current = { id: 'delivery-existing', version: '3', projectId: 'p1', supplierId: 's1', orderNo: 'D-1', deliveryDate: '2026-09-10', note: '', lines: [{ id: 'stable-line', materialName: '砂', spec: '', unit: '吨', qty: 1, unitPrice: 10, amount: 10, amountSource: 'manual', note: '' }] }
    byId.mockImplementation(() => current)
    update.mockRejectedValue(deliveryProblem('conflict', '记录已更新，请重新核对'))
    confirm.mockResolvedValue(true)
    const shown = ref(true)
    render(defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => shown.value ? h(DeliveryArchiveFormPage) : h('div', '其他页面') }) }), { global })
    await flushPromises()
    await fireEvent.update(screen.getByLabelText(/修订原因/), '保留人工修正')
    await fireEvent.update(screen.getByLabelText(/送货日期/), '2026-09-11')
    await fireEvent.click(screen.getByRole('button', { name: '保存送货单' }))
    await flushPromises()
    current.version = '4'
    await fireEvent.click(screen.getByRole('button', { name: '重新核对当前记录' }))
    await flushPromises()
    let accept!: (value: boolean) => void
    confirm.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      accept = resolve
    }))
    await fireEvent.click(screen.getByRole('button', { name: '采用已核对的当前版本' }))
    if (change === '再次更新')
      current.version = '5'
    else if (change === '失去写权限')
      scope.canWrite = false
    else
      shown.value = false
    await nextTick()
    accept(true)
    await flushPromises()
    expect(update).toHaveBeenCalledTimes(1)
    scope.canWrite = true
    shown.value = true
    await flushPromises()
    expect((screen.getByLabelText(/送货日期/) as HTMLInputElement).value).toBe('2026-09-11')
    await fireEvent.click(screen.getByRole('button', { name: '保存送货单' }))
    await flushPromises()
    expect(update).toHaveBeenLastCalledWith('delivery-existing', expect.anything(), '保留人工修正', '3')
  })

  it('冲突后重新核对失败关闭保存入口，原地重试仍保留人工稿和旧版本', async () => {
    route.params = { id: 'delivery-existing' }
    const current = { id: 'delivery-existing', version: '3', projectId: 'p1', supplierId: 's1', orderNo: 'D-1', deliveryDate: '2026-09-10', note: '', lines: [{ id: 'stable-line', materialName: '砂', spec: '', unit: '吨', qty: 1, unitPrice: 10, amount: 10, amountSource: 'manual', note: '' }] }
    byId.mockImplementation(() => current)
    update.mockRejectedValue(deliveryProblem('conflict', '记录已更新，请重新核对'))
    confirm.mockResolvedValue(true)
    render(DeliveryArchiveFormPage, { global })
    await flushPromises()
    await fireEvent.update(screen.getByLabelText(/修订原因/), '保留人工修正')
    await fireEvent.update(screen.getByLabelText(/送货日期/), '2026-09-11')
    await fireEvent.click(screen.getByRole('button', { name: '保存送货单' }))
    await flushPromises()
    current.version = '4'
    load.mockRejectedValueOnce(new Error('暂时无法读取当前记录'))
    await fireEvent.click(screen.getByRole('button', { name: '重新核对当前记录' }))
    await flushPromises()
    expect(screen.getByRole('alert').textContent).toContain('暂时无法读取当前记录')
    expect(screen.queryByRole('button', { name: '保存送货单' })).toBeNull()
    expect(screen.queryByRole('region', { name: '核对当前送货记录' })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    await flushPromises()
    expect((screen.getByLabelText(/送货日期/) as HTMLInputElement).value).toBe('2026-09-11')
    await fireEvent.click(screen.getByRole('button', { name: '保存送货单' }))
    await flushPromises()
    expect(update).toHaveBeenLastCalledWith('delivery-existing', expect.anything(), '保留人工修正', '3')
  })

  it.each([false, true])('保存失败后切到另一带 ID 页面再返回，重验权限但保留同一表单人工稿、原因与原版本（重读失败后重试：%s）', async (retryRead) => {
    const activeRoute = reactive({ fullPath: '/material/delivery/archive/form/delivery-existing?origin=real', params: { id: 'delivery-existing' }, query: { origin: 'real' } })
    vi.stubGlobal('useRoute', () => activeRoute)
    byId.mockReturnValue({ id: 'delivery-existing', version: '3', projectId: 'p1', supplierId: 's1', orderNo: 'D-1', deliveryDate: '2026-09-10', note: '', lines: [{ id: 'stable-line', materialName: '砂', spec: '', unit: '吨', qty: 1, unitPrice: 10, amount: 10, amountSource: 'manual', note: '' }] })
    update.mockRejectedValue(new Error('临时保存失败'))
    confirm.mockResolvedValue(true)
    const shown = ref(true)
    render(defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => shown.value ? h(DeliveryArchiveFormPage) : h('div', '其他页面') }) }), { global })
    await flushPromises()
    await fireEvent.update(screen.getByLabelText(/修订原因/), '待提交的人工原因')
    await fireEvent.update(screen.getByLabelText(/送货日期/), '2026-09-11')
    await fireEvent.click(screen.getByRole('button', { name: '保存送货单' }))
    await flushPromises()
    shown.value = false
    await nextTick()
    activeRoute.fullPath = '/project/other-id?origin=real'
    activeRoute.params.id = 'other-id'
    await flushPromises()
    activeRoute.fullPath = '/material/delivery/archive/form/delivery-existing?origin=real'
    activeRoute.params.id = 'delivery-existing'
    if (retryRead)
      load.mockRejectedValueOnce(new Error('暂时无法重新核验权限'))
    shown.value = true
    await flushPromises()
    expect(load).toHaveBeenCalledTimes(2)
    if (retryRead) {
      expect(screen.getByRole('alert').textContent).toContain('暂时无法重新核验权限')
      expect(screen.queryByRole('button', { name: '保存送货单' })).toBeNull()
      await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
      await flushPromises()
      expect(load).toHaveBeenCalledTimes(3)
    }
    expect((screen.getByLabelText(/修订原因/) as HTMLTextAreaElement).value).toBe('待提交的人工原因')
    expect((screen.getByLabelText(/送货日期/) as HTMLInputElement).value).toBe('2026-09-11')
    await fireEvent.click(screen.getByRole('button', { name: '保存送货单' }))
    await flushPromises()
    expect(update).toHaveBeenLastCalledWith('delivery-existing', expect.objectContaining({ deliveryDate: '2026-09-11' }), '待提交的人工原因', '3')
  })
})
