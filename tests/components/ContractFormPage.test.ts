import type { Component } from 'vue'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computed,
  defineComponent,
  h,
  nextTick,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
} from 'vue'
import ContractFormPage from '~/components/contract/ContractFormPage.vue'
import { f2FormDefaults } from '~/lib/contract/page'

const { loadForm } = vi.hoisted(() => ({ loadForm: vi.fn() }))
vi.mock('~/lib/contract/forms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/contract/forms')>()
  return { ...actual, loadF2Form: loadForm, listContractFormAttachments: vi.fn().mockResolvedValue([]) }
})

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: vi.fn(),
}))

const route = {
  fullPath: '/contract/company-expense/form',
  params: {} as Record<string, string>,
  query: {} as Record<string, string>,
}
const load = vi.fn()
const saveForm = vi.fn()

const EntityFormShellStub = defineComponent({
  props: {
    title: { type: String, required: true },
    state: { type: String, default: 'ready' },
    stateTitle: { type: String, default: '' },
    stateDescription: { type: String, default: '' },
    stateActionLabel: { type: String, default: '' },
  },
  emits: ['stateAction'],
  setup(props, { emit, slots }) {
    return () => h('main', { 'data-testid': 'contract-form-shell' }, [
      h('h1', props.title),
      props.state === 'ready' ? slots.status?.() : null,
      props.state === 'error'
        ? h('section', { role: 'alert' }, [
            h('p', props.stateTitle),
            h('p', props.stateDescription),
            h('button', {
              type: 'button',
              onClick: () => emit('stateAction'),
            }, props.stateActionLabel),
          ])
        : null,
      props.state === 'ready' ? slots.default?.() : null,
    ])
  },
})

const ContractFormFieldsStub = defineComponent({
  props: {
    draft: { type: Object, required: true },
    fieldErrors: { type: Object, required: true },
  },
  emits: ['patch', 'clearError'],
  setup(props) {
    return () => h('section', [
      h('input', {
        'aria-label': '合同名称',
        'aria-invalid': Boolean(props.fieldErrors.name),
        'value': props.draft.name,
      }),
      h('input', {
        'aria-label': '对方单位',
        'aria-invalid': Boolean(props.fieldErrors.counterparty),
        'value': props.draft.counterparty,
      }),
      h('input', {
        'aria-label': '签订日期',
        'aria-invalid': Boolean(props.fieldErrors.signDate),
        'value': props.draft.signDate,
      }),
    ])
  },
})

const FormFooterStub = defineComponent({
  emits: ['action'],
  setup(_props, { emit }) {
    return () => h('button', {
      type: 'button',
      onClick: () => emit('action', 'save'),
    }, '保存')
  },
})

const EmptyStub = defineComponent({
  setup: () => () => h('div'),
})

const globalComponents: Record<string, Component> = {
  EntityFormShell: EntityFormShellStub,
  ContractFormFields: ContractFormFieldsStub,
  ContractLineItemsEditor: EmptyStub,
  ContractAttachmentSection: EmptyStub,
  FormFooter: FormFooterStub,
}

describe('辅助合同整页表单状态', () => {
  beforeEach(() => {
    route.fullPath = '/contract/company-expense/form'
    route.params = {}
    route.query = {}
    loadForm.mockReset()
    load.mockReset()
    saveForm.mockReset()
    load.mockResolvedValue(undefined)
    saveForm.mockResolvedValue({ id: 'company-expense-id' })

    vi.stubGlobal('computed', computed)
    vi.stubGlobal('nextTick', nextTick)
    vi.stubGlobal('onMounted', onMounted)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('shallowRef', shallowRef)
    vi.stubGlobal('useTemplateRef', useTemplateRef)
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('useTabTitle', vi.fn())
    vi.stubGlobal('useState', (_key: string, init: () => boolean) => ref(init()))
    vi.stubGlobal('useTabsStore', () => ({ registerCloseGuard: () => () => {}, tabs: [], close: vi.fn(), open: vi.fn() }))
    vi.stubGlobal('useContractStore', () => ({
      load,
      byId: vi.fn(),
      searchProjects: vi.fn().mockResolvedValue([]),
      searchCustomers: vi.fn().mockResolvedValue([]),
      searchSuppliers: vi.fn().mockResolvedValue([]),
      searchOriginalContracts: vi.fn().mockResolvedValue([]),
      searchSettlementContracts: vi.fn().mockResolvedValue([]),
      saveForm,
    }))
    vi.stubGlobal('useKitUI', () => ({
      confirm: vi.fn().mockResolvedValue(true),
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    }))
    vi.stubGlobal('useContractFormAttachments', () => ({
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
      removePending: vi.fn(),
      patchPending: vi.fn(),
      toggleExisting: vi.fn(),
    }))
  })

  it.each([
    { kind: 'construction', status: '审批中', tone: 'warn' },
    { kind: 'construction', status: '已签订', tone: 'neutral' },
    { kind: 'construction', status: '已结清', tone: 'ok' },
    { kind: 'subcontract', status: '履约中', tone: 'brand' },
    { kind: 'subcontract', status: '历史业务状态', tone: 'neutral' },
    { kind: 'material', status: '已结算', tone: 'warn' },
    { kind: 'material', status: '草稿', tone: 'neutral' },
    { kind: 'company_expense', status: '审批中', tone: 'warn' },
    { kind: 'company_expense', status: '履约中', tone: 'brand' },
    { kind: 'company_expense', status: '历史业务状态', tone: 'neutral' },
    { kind: 'other_expense', status: '已结清', tone: 'ok' },
    { kind: 'other_settlement', status: '已确认', tone: 'ok' },
    { kind: 'material_settlement', status: '待确认', tone: 'warn' },
    { kind: 'material_settlement', status: '历史业务状态', tone: 'neutral' },
  ] as const)('编辑 $kind 的 $status 保留原文并使用领域语义色 $tone', async ({ kind, status, tone }) => {
    const id = `status-fixture-${kind}`
    route.fullPath = `/contract/${kind}/form/${id}`
    route.params = { id }
    loadForm.mockResolvedValue({ ...f2FormDefaults(kind), id, name: '合成状态合同', status })
    render(ContractFormPage, { props: { kind }, global: { components: globalComponents } })
    await flushPromises()
    const tag = screen.getByText(status)
    expect(tag.getAttribute('data-ui')).toBe('status-tag')
    expect(tag.getAttribute('data-tone')).toBe(tone)
  })

  it('载入失败时隐藏可写表单，并允许重新载入', async () => {
    load.mockRejectedValueOnce(new Error('数据库暂不可用'))
      .mockResolvedValueOnce(undefined)

    render(ContractFormPage, {
      props: { kind: 'company_expense' },
      global: { components: globalComponents },
    })
    await flushPromises()

    expect(screen.getByRole('alert').textContent).toContain('数据库暂不可用')
    expect(screen.queryByRole('textbox', { name: '合同名称' })).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '重新载入' }))
    await flushPromises()

    expect(screen.getByRole('textbox', { name: '合同名称' })).not.toBeNull()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('普通必填校验设置 aria-invalid 并聚焦第一个错误', async () => {
    render(ContractFormPage, {
      props: { kind: 'company_expense' },
      global: { components: globalComponents },
    })
    await flushPromises()

    await fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      const first = screen.getByRole('textbox', { name: '合同名称' })
      expect(first.getAttribute('aria-invalid')).toBe('true')
      expect(document.activeElement).toBe(first)
    })
    expect(saveForm).not.toHaveBeenCalled()
  })
})
