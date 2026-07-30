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
}
const loadOne = vi.fn()
const loadAttachments = vi.fn()
const loadContractOptions = vi.fn()
const saveForm = vi.fn()

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
    fieldErrors: { type: Object, required: true },
  },
  setup(props) {
    return () => h('section', [
      h('input', {
        'aria-label': '变更名称',
        'data-field': 'name',
        'aria-invalid': Boolean(props.fieldErrors.name),
      }),
    ])
  },
})

const FormFooterStub = defineComponent({
  emits: ['action'],
  setup(_props, { emit }) {
    return () => h('button', {
      type: 'button',
      onClick: () => emit('action', 'saveSubmit'),
    }, '保存并提交')
  },
})

const EmptyStub = defineComponent({
  setup: () => () => h('div'),
})

const globalComponents: Record<string, Component> = {
  EntityFormShell: EntityFormShellStub,
  OwnerDocumentFormFields: OwnerDocumentFormFieldsStub,
  OwnerDocumentLineGrid: EmptyStub,
  FileRefAttachmentSection: EmptyStub,
  FormFooter: FormFooterStub,
}

describe('甲方与分包单据整页表单状态', () => {
  beforeEach(() => {
    route.fullPath = '/owner/change/new'
    route.params = {}
    loadOne.mockReset()
    loadAttachments.mockReset()
    loadContractOptions.mockReset()
    saveForm.mockReset()
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
      saveAttachments: vi.fn(),
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
})
