import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, onMounted, ref, shallowRef, toRef } from 'vue'
import FinanceFormPage from '~/components/finance/FinanceFormPage.vue'
import FinancePaymentTypeStep from '~/components/finance/FinancePaymentTypeStep.vue'
import MaterialFormPage from '~/components/material/MaterialFormPage.vue'
import EntityFormShell from '~/components/ui/EntityFormShell.vue'
import FormFooter from '~/components/ui/FormFooter.vue'
import KitButton from '~/components/ui/KitButton.vue'
import { loadMaterialForm } from '~/lib/material/forms'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))
vi.mock('~/lib/material/forms', async (importOriginal) => {
  const original = await importOriginal<typeof import('~/lib/material/forms')>()
  return {
    ...original,
    loadMaterialForm: vi.fn(),
    listMaterialFormAttachments: vi.fn().mockResolvedValue([]),
  }
})

const route = { fullPath: '', params: {} as Record<string, string>, query: {} }
const confirm = vi.fn()
const navigate = vi.fn()
const saveForm = vi.fn()
const saveAttachments = vi.fn()
const fieldStub = defineComponent({
  props: {
    draft: { type: Object, required: true },
    readonly: { type: Boolean, default: false },
  },
  emits: ['patch'],
  setup(props, { emit }) {
    return () => h('section', { id: 'section-basic' }, [
      h('input', {
        'aria-label': '备注草稿',
        'value': props.draft.note ?? '',
        'disabled': props.readonly,
        'onInput': (event: Event) => emit('patch', { note: (event.target as HTMLInputElement).value }),
      }),
    ])
  },
})
const attachmentStub = defineComponent({
  setup: () => () => h('section', { id: 'section-attachments' }, '附件内容'),
})
const components = {
  EntityFormShell,
  FormFooter,
  KitButton,
  FinancePaymentTypeStep,
  FinanceFormFields: fieldStub,
  MaterialFormFields: fieldStub,
  FileRefAttachmentSection: attachmentStub,
}

function attachmentState() {
  return {
    attachments: ref([]),
    pendingAttachments: ref([]),
    pendingRemoveIds: ref([]),
    pendingRestoreIds: ref([]),
    desktopAttachmentPicker: false,
    dirty: ref(false),
    reset: vi.fn(),
    clearPending: vi.fn(),
    changes: () => ({ add: [], removeIds: [], restoreIds: [] }),
    handleFiles: vi.fn(),
    pickNativeFiles: vi.fn(),
    toggleExisting: vi.fn(),
    removePending: vi.fn(),
    patchPending: vi.fn(),
  }
}

describe('财务和物资整页表单布局接线', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    route.params = {}
    route.fullPath = '/finance/payment/new'
    confirm.mockResolvedValue(false)
    navigate.mockResolvedValue(undefined)
    saveForm.mockResolvedValue({ id: 'saved-id' })
    saveAttachments.mockResolvedValue(undefined)
    vi.mocked(loadMaterialForm).mockResolvedValue(null)
    for (const [name, value] of Object.entries({ computed, nextTick, onMounted, ref, shallowRef, toRef }))
      vi.stubGlobal(name, value)
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('navigateTo', navigate)
    vi.stubGlobal('useTabTitle', vi.fn())
    vi.stubGlobal('useKitUI', () => ({ confirm, success: vi.fn(), warning: vi.fn(), error: vi.fn() }))
    vi.stubGlobal('useTabsStore', () => ({ tabs: [], close: vi.fn(), open: vi.fn(), registerCloseGuard: vi.fn(() => vi.fn()) }))
    const store = {
      saveForm,
      saveAttachments,
      searchProjects: vi.fn(),
      searchCustomers: vi.fn(),
      searchSuppliers: vi.fn(),
      searchCrews: vi.fn(),
    }
    vi.stubGlobal('useFinanceStore', () => store)
    vi.stubGlobal('useMaterialStore', () => store)
    vi.stubGlobal('useFinanceFormAttachments', attachmentState)
    vi.stubGlobal('useMaterialFormAttachments', attachmentState)
  })

  it('选择付款类型前不出现分区或保存动作，进入表单后保留草稿和离开保护', async () => {
    render(FinanceFormPage, { props: { kind: 'payment_application' }, global: { components } })
    await flushPromises()
    expect(screen.getByRole('heading', { name: '选择付款业务类型' })).not.toBeNull()
    expect(screen.queryByRole('navigation', { name: '表单分区' })).toBeNull()
    expect(screen.queryByRole('group', { name: '表单操作' })).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '公司付款' }))
    expect(screen.getByRole('heading', { name: '新建 · 付款申请' })).not.toBeNull()
    expect(screen.getByRole('navigation', { name: '表单分区' })).not.toBeNull()
    await fireEvent.update(screen.getByRole('textbox', { name: '备注草稿' }), '保留的付款备注')
    await fireEvent.click(screen.getByRole('link', { name: '附件与备注' }))
    expect(window.location.hash).toBe('')
    await fireEvent.click(screen.getByRole('button', { name: '返回付款申请' }))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '放弃修改' }))
    expect(navigate).not.toHaveBeenCalled()

    await fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await flushPromises()
    expect(saveForm).toHaveBeenCalledWith(
      'payment_application',
      expect.objectContaining({ bizType: '公司付款', note: '保留的付款备注' }),
      'draft',
      { add: [], removeIds: [], restoreIds: [] },
    )
  })

  it('物资表单分区导航保留草稿，底部保存继续调用原领域动作', async () => {
    route.fullPath = '/material/requisition/new'
    render(MaterialFormPage, { props: { kind: 'mat_requisition' }, global: { components } })
    await flushPromises()
    expect((screen.getByRole('button', { name: '保存草稿' }) as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.update(screen.getByRole('textbox', { name: '备注草稿' }), '保留的下料备注')
    await fireEvent.click(screen.getByRole('link', { name: '计划附件' }))
    expect(window.location.hash).toBe('')
    expect((screen.getByRole('textbox', { name: '备注草稿' }) as HTMLInputElement).value).toBe('保留的下料备注')
    await fireEvent.click(screen.getByRole('button', { name: '返回下料单' }))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '放弃修改' }))
    expect(navigate).not.toHaveBeenCalled()

    await fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await flushPromises()
    expect(saveForm).toHaveBeenCalledWith(
      'mat_requisition',
      expect.objectContaining({ note: '保留的下料备注' }),
      'draft',
      { add: [], removeIds: [], restoreIds: [] },
    )
  })

  it('已生效物资记录仍锁定字段，底部只保留附件保存动作', async () => {
    route.fullPath = '/material/requisition/posted-id/edit'
    route.params = { id: 'posted-id' }
    vi.mocked(loadMaterialForm).mockResolvedValue({
      id: 'posted-id',
      status: 'submitted',
      plannedQty: 10,
      arrivedQty: 0,
      remainingQty: 10,
    })
    render(MaterialFormPage, { props: { kind: 'mat_requisition' }, global: { components } })
    await flushPromises()

    expect(screen.getByText('已生效')).not.toBeNull()
    expect((screen.getByRole('textbox', { name: '备注草稿' }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: '保存草稿' })).toBeNull()
    expect(screen.queryByRole('button', { name: '保存并提交' })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '保存附件' }))
    await flushPromises()
    expect(saveAttachments).toHaveBeenCalledWith('mat_requisition', 'posted-id', { add: [], removeIds: [], restoreIds: [] })
    expect(saveForm).not.toHaveBeenCalled()
  })
})
