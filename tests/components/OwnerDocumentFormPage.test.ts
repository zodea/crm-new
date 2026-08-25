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
} from 'vue'
import OwnerDocumentFormPage from '~/components/owner-document/OwnerDocumentFormPage.vue'
import { ownerCommercialDocumentProblem, OwnerCommercialDocumentRepositoryProblem } from '~/lib/owner-document/central-repository'

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: vi.fn(),
}))

vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()
  return {
    ...actual,
    useDebounceFn: (fn: (...args: unknown[]) => unknown) => fn,
  }
})

const route = {
  fullPath: '/owner/change/new',
  params: {} as Record<string, string>,
  query: {} as Record<string, string>,
}
const loadOne = vi.fn()
const loadAttachments = vi.fn()
const loadContractOptions = vi.fn()
const saveForm = vi.fn()
const saveAttachments = vi.fn()

const EntityFormShellStub = defineComponent({
  props: {
    title: { type: String, required: true },
    backLabel: { type: String, default: '' },
    sections: { type: Array, default: () => [] },
    state: { type: String, default: 'ready' },
    stateTitle: { type: String, default: '' },
    stateDescription: { type: String, default: '' },
    stateActionLabel: { type: String, default: '' },
  },
  emits: ['stateAction'],
  setup(props, { emit, slots }) {
    return () => h('main', { 'data-testid': 'owner-document-form-shell' }, [
      h('h1', props.title),
      slots.status?.(),
      h('button', { type: 'button' }, props.backLabel),
      h('p', { 'data-testid': 'sections' }, (props.sections as Array<{ label: string }>).map(section => section.label).join('|')),
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

const OwnerDocumentFormFieldsStub = defineComponent({
  props: {
    draft: { type: Object, required: true },
    fieldErrors: { type: Object, required: true },
    readonly: { type: Boolean, default: false },
  },
  setup(props) {
    return () => h('section', [
      h('input', {
        'aria-label': '变更名称',
        'data-field': 'name',
        'aria-invalid': Boolean(props.fieldErrors.name),
        'readonly': props.readonly,
        'value': String(props.draft.name ?? ''),
      }),
    ])
  },
})

const FormFooterStub = defineComponent({
  props: {
    actions: { type: Array, default: () => [] },
  },
  emits: ['action'],
  setup(props, { emit }) {
    return () => h('div', [
      ...(props.actions as string[]).includes('saveSubmit')
        ? [h('button', {
            type: 'button',
            onClick: () => emit('action', 'saveSubmit'),
          }, '保存并提交')]
        : [],
      ...(props.actions as string[]).includes('save')
        ? [h('button', {
            type: 'button',
            onClick: () => emit('action', 'save'),
          }, '保存附件')]
        : [],
    ])
  },
})

const OwnerDocumentLineGridStub = defineComponent({
  props: { error: { type: String, default: '' } },
  setup(props) {
    return () => props.error
      ? h('p', { 'data-field': 'lines', 'tabindex': '-1', 'role': 'alert' }, props.error)
      : h('section')
  },
})

const FileRefAttachmentSectionStub = defineComponent({
  props: { readonly: { type: Boolean, default: false } },
  setup(props) {
    return () => h('section', [
      props.readonly ? null : h('button', { type: 'button' }, '选择附件'),
    ])
  },
})

const globalComponents: Record<string, Component> = {
  EntityFormShell: EntityFormShellStub,
  OwnerDocumentFormFields: OwnerDocumentFormFieldsStub,
  OwnerDocumentLineGrid: OwnerDocumentLineGridStub,
  FileRefAttachmentSection: FileRefAttachmentSectionStub,
  FormFooter: FormFooterStub,
}

describe('甲方与分包单据整页表单状态', () => {
  beforeEach(() => {
    route.fullPath = '/owner/change/new'
    route.params = {}
    route.query = {}
    loadOne.mockReset()
    loadAttachments.mockReset()
    loadContractOptions.mockReset()
    saveForm.mockReset()
    saveAttachments.mockReset()
    loadOne.mockResolvedValue(null)
    loadAttachments.mockResolvedValue([])
    loadContractOptions.mockResolvedValue([])
    saveForm.mockResolvedValue({ id: 'owner-document-id' })

    vi.stubGlobal('computed', computed)
    vi.stubGlobal('nextTick', nextTick)
    vi.stubGlobal('onMounted', onMounted)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('shallowRef', shallowRef)
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('useTabTitle', vi.fn())
    vi.stubGlobal('useTabsStore', () => ({
      tabs: [],
      close: vi.fn(),
      open: vi.fn(),
    }))
    vi.stubGlobal('useOwnerDocumentStore', () => ({
      loadOne,
      loadAttachments,
      loadBasicOptions: vi.fn().mockResolvedValue([]),
      loadContractOptions,
      loadBoqLines: vi.fn().mockResolvedValue([]),
      loadContractSummary: vi.fn().mockResolvedValue(null),
      saveForm,
      saveAttachments,
    }))
    vi.stubGlobal('useKitUI', () => ({
      confirm: vi.fn().mockResolvedValue(true),
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    }))
    vi.stubGlobal('useOwnerDocumentFormAttachments', () => ({
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
    }))
    vi.stubGlobal('useOwnerDocumentLifecycle', () => ({
      loading: ref(false),
      penaltyDeductions: ref([]),
      deductionSettlementId: ref(null),
      deductionAmount: ref(0),
      deductionNote: ref(''),
      auditMode: ref(false),
      canApproveChange: ref(false),
      canDeductPenalty: ref(false),
      acceptanceAction: ref(null),
      refreshDeductions: vi.fn().mockResolvedValue(undefined),
      fetchSettlements: vi.fn().mockResolvedValue([]),
      approveChange: vi.fn(),
      moveAcceptance: vi.fn(),
      auditReport: vi.fn(),
      deductPenalty: vi.fn(),
    }))
  })

  it('uses the dynamic title, return label and sections from the document kind', async () => {
    render(OwnerDocumentFormPage, {
      props: { kind: 'owner_change' },
      global: { components: globalComponents },
    })
    await flushPromises()

    expect(screen.getByRole('heading', { name: '新建 · 甲方变洽签' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '返回甲方变洽签' })).not.toBeNull()
    expect(screen.getByTestId('sections').textContent)
      .toBe('基本信息|变更明细|附件与备注')
  })

  it('hides the writable form after a load failure and retries in place', async () => {
    route.fullPath = '/owner/change/change-real'
    route.params = { id: 'change-real' }
    loadOne.mockRejectedValueOnce(new Error('数据库暂不可用'))
      .mockResolvedValueOnce({
        id: 'change-real',
        status: 'draft',
        name: '现场签证',
        projectId: null,
        contractId: null,
        lines: [],
      })

    render(OwnerDocumentFormPage, {
      props: { kind: 'owner_change' },
      global: { components: globalComponents },
    })
    await flushPromises()

    expect(screen.getByRole('alert').textContent).toContain('数据库暂不可用')
    expect(screen.queryByRole('textbox', { name: '变更名称' })).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '重新载入' }))
    await flushPromises()

    expect(screen.getByRole('textbox', { name: '变更名称' })).not.toBeNull()
    expect(loadOne).toHaveBeenCalledTimes(2)
  })

  it('uses the kind-aware status label and tone from the matching list', async () => {
    route.fullPath = '/owner/change/change-submitted'
    route.params = { id: 'change-submitted' }
    loadOne.mockResolvedValue({
      id: 'change-submitted',
      status: 'submitted',
      name: '已上报签证',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      lines: [],
    })

    render(OwnerDocumentFormPage, {
      props: { kind: 'owner_change' },
      global: { components: globalComponents },
    })
    await flushPromises()

    const status = screen.getByText('已上报')
    expect(status.classList.contains('chip-warn')).toBe(true)
    expect(screen.queryByText('已提交')).toBeNull()
  })

  it('focuses the first invalid control before opening the submit confirmation', async () => {
    const confirm = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('useKitUI', () => ({
      confirm,
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    }))

    render(OwnerDocumentFormPage, {
      props: { kind: 'owner_change' },
      global: { components: globalComponents },
    })
    await flushPromises()

    await fireEvent.click(screen.getByRole('button', { name: '保存并提交' }))

    await waitFor(() => {
      const first = screen.getByRole('textbox', { name: '变更名称' })
      expect(first.getAttribute('aria-invalid')).toBe('true')
      expect(document.activeElement).toBe(first)
    })
    expect(confirm).not.toHaveBeenCalled()
    expect(saveForm).not.toHaveBeenCalled()
  })

  it('空变更行在命令前留在页面，并聚焦明细错误', async () => {
    route.fullPath = '/owner/change/change-invalid'
    route.params = { id: 'change-invalid' }
    loadOne.mockResolvedValue({
      id: 'change-invalid',
      status: 'draft',
      name: '无效变更行',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      applicationDate: '2026-08-25',
      reason: '验证明细',
      _centralBaseVersion: '1',
      lines: [{ operation: 'qty', boqLineId: '', deltaQty: null }],
    })

    render(OwnerDocumentFormPage, {
      props: { kind: 'owner_change' },
      global: { components: globalComponents },
    })
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '保存并提交' }))

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('alert')))
    expect(screen.getByRole('alert').textContent).toContain('BOQ')
    expect(saveForm).not.toHaveBeenCalled()
  })

  it('将中央字段错误映射回明细并聚焦首错', async () => {
    route.fullPath = '/owner/change/change-server-invalid'
    route.params = { id: 'change-server-invalid' }
    loadOne.mockResolvedValue({
      id: 'change-server-invalid',
      status: 'draft',
      name: '纯金额签证',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      applicationDate: '2026-08-25',
      reason: '服务端二次校验',
      approvedTaxInclusiveAmount: 100,
      _centralBaseVersion: '1',
      lines: [],
    })
    saveForm.mockRejectedValue(new OwnerCommercialDocumentRepositoryProblem({
      code: 'validation-failed',
      message: '变更明细需要修正',
      retryable: false,
      fieldErrors: { lines: ['第 1 行：BOQ 行已失效'] },
      traceId: 'trace-323',
    }))

    render(OwnerDocumentFormPage, {
      props: { kind: 'owner_change' },
      global: { components: globalComponents },
    })
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '保存并提交' }))
    await flushPromises()

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('alert')))
    expect(screen.getByRole('alert').textContent).toContain('BOQ 行已失效')
  })

  it('中央 409 且最新版已受保护时只读保留本页内容并停用所有命令', async () => {
    route.fullPath = '/owner/change/change-draft?origin=real'
    route.params = { id: 'change-draft' }
    route.query = { origin: 'real' }
    loadOne.mockResolvedValueOnce({
      id: 'change-draft',
      status: 'draft',
      name: '本页未提交签证',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      applicationDate: '2026-08-25',
      reason: '现场调整',
      approvedTaxInclusiveAmount: 100,
      _centralBaseVersion: '1',
      lines: [],
    }).mockResolvedValueOnce({
      id: 'change-draft',
      status: 'submitted',
      name: '服务器最新签证',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      _centralBaseVersion: '2',
      lines: [],
    })
    saveForm.mockRejectedValue(new OwnerCommercialDocumentRepositoryProblem(
      ownerCommercialDocumentProblem('conflict', '中央版本已更新'),
    ))
    const confirm = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('useKitUI', () => ({ confirm, success: vi.fn(), warning: vi.fn(), error: vi.fn() }))

    render(OwnerDocumentFormPage, {
      props: { kind: 'owner_change' },
      global: { components: globalComponents },
    })
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '保存并提交' }))
    await flushPromises()

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: '单据已有新版本',
      confirmLabel: '保留本页供复制',
      cancelLabel: '改用服务器最新版',
    }))
    expect(loadOne).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status').textContent).toContain('仅供核对和复制')
    const name = screen.getByRole('textbox', { name: '变更名称' }) as HTMLInputElement
    expect(name.value).toBe('本页未提交签证')
    expect(name.readOnly).toBe(true)
    expect(screen.queryByRole('button', { name: '保存并提交' })).toBeNull()
    expect(screen.queryByRole('button', { name: '选择附件' })).toBeNull()
  })

  it('已申报报量同状态附件冲突可换基准重试，不误转只读', async () => {
    route.fullPath = '/owner/report/form/report-reported?origin=real'
    route.params = { id: 'report-reported' }
    route.query = { origin: 'real' }
    const reported = {
      id: 'report-reported',
      status: 'reported',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      periodNo: '2026-08',
      applicationDate: '2026-08-25',
      _centralBaseVersion: '1',
      lines: [{ boqLineId: 'boq-1', reportedQty: 3, auditedQty: 2 }],
    }
    loadOne.mockResolvedValueOnce(reported).mockResolvedValueOnce({
      ...reported,
      _centralBaseVersion: '2',
      lines: [{ boqLineId: 'boq-1', reportedQty: 3, auditedQty: null }],
    })
    saveAttachments.mockRejectedValue(new OwnerCommercialDocumentRepositoryProblem(
      ownerCommercialDocumentProblem('conflict', '中央版本已更新'),
    ))
    const confirm = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('useKitUI', () => ({ confirm, success: vi.fn(), warning: vi.fn(), error: vi.fn() }))

    render(OwnerDocumentFormPage, {
      props: { kind: 'owner_report' },
      global: { components: globalComponents },
    })
    await flushPromises()
    expect(screen.getByRole('button', { name: '选择附件' })).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '保存附件' }))
    await flushPromises()

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: '单据已有新版本',
      confirmLabel: '保留我的内容',
    }))
    expect(screen.queryByText(/仅供核对和复制/)).toBeNull()
    expect(screen.getByRole('button', { name: '保存附件' })).not.toBeNull()
  })
})
