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
  watch,
} from 'vue'
import MasterDataFormPage from '~/components/master-data/MasterDataFormPage.vue'

const formMocks = vi.hoisted(() => ({
  listFormAttachments: vi.fn(),
  loadProjectForm: vi.fn(),
}))

vi.mock('~/lib/master-data/forms', () => ({
  listFormAttachments: formMocks.listFormAttachments,
  loadProjectForm: formMocks.loadProjectForm,
}))

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: vi.fn(),
}))

const route = {
  fullPath: '/project/form',
  path: '/project/form',
  params: {} as Record<string, string>,
  query: {} as Record<string, string>,
}
const navigateTo = vi.fn()
const saveForm = vi.fn()
const closeTab = vi.fn()
const confirm = vi.fn()

const EntityFormShellStub = defineComponent({
  props: {
    title: { type: String, required: true },
    backLabel: { type: String, required: true },
    sections: { type: Array, default: () => [] },
    state: { type: String, default: 'ready' },
  },
  emits: ['back', 'stateAction'],
  setup(props, { emit, slots }) {
    return () => h('main', {
      'data-testid': 'project-form-shell',
      'data-section-count': props.sections.length,
    }, [
      h('button', {
        'type': 'button',
        'aria-label': props.backLabel,
        'onClick': () => emit('back'),
      }, props.backLabel),
      h('h1', props.title),
      props.state === 'ready' ? slots.default?.() : null,
      props.state === 'ready' ? slots.footer?.() : null,
    ])
  },
})

const ProjectFieldsStub = defineComponent({
  props: {
    modelValue: { type: Object, required: true },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    function patchDraft(patch: Record<string, unknown>) {
      emit('update:modelValue', { ...props.modelValue, ...patch })
    }
    return () => h('section', [
      h('input', {
        'aria-label': '项目名称',
        'value': props.modelValue.name,
        'onInput': (event: Event) => patchDraft({
          name: (event.target as HTMLInputElement).value,
        }),
      }),
      h('input', {
        'aria-label': '项目经理',
        'value': props.modelValue.manager,
        'onInput': (event: Event) => patchDraft({
          manager: (event.target as HTMLInputElement).value,
        }),
      }),
      h('button', {
        type: 'button',
        onClick: () => patchDraft({ customerId: 'customer-primary-id' }),
      }, '选择主客户'),
      h('button', {
        type: 'button',
        onClick: () => patchDraft({ secondaryCustomerId: 'customer-secondary-id' }),
      }, '选择次客户'),
    ])
  },
})

const FormFooterStub = defineComponent({
  emits: ['action'],
  setup(_props, { emit }) {
    return () => h('div', [
      h('button', { type: 'button', onClick: () => emit('action', 'cancel') }, '取消'),
      h('button', { type: 'button', onClick: () => emit('action', 'save') }, '保存'),
    ])
  },
})

const EmptyStub = defineComponent({
  setup: () => () => h('div'),
})

const SectionHeaderStub = defineComponent({
  props: { title: { type: String, required: true } },
  setup: props => () => h('h2', props.title),
})

const globalComponents: Record<string, Component> = {
  EntityFormShell: EntityFormShellStub,
  MasterDataFormFields: ProjectFieldsStub,
  MasterDataAttachmentSection: EmptyStub,
  FormFooter: FormFooterStub,
  SectionHeader: SectionHeaderStub,
}

describe('项目整页表单', () => {
  beforeEach(() => {
    route.fullPath = '/project/form'
    route.path = '/project/form'
    route.params = {}
    navigateTo.mockReset()
    saveForm.mockReset()
    closeTab.mockReset()
    confirm.mockReset()
    formMocks.listFormAttachments.mockReset()
    formMocks.loadProjectForm.mockReset()
    formMocks.listFormAttachments.mockResolvedValue([])
    formMocks.loadProjectForm.mockResolvedValue(null)
    saveForm.mockResolvedValue({
      id: 'project-created-id',
      logId: 'log-1',
      attachmentIds: [],
    })
    confirm.mockResolvedValue(true)

    vi.stubGlobal('computed', computed)
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('nextTick', nextTick)
    vi.stubGlobal('onMounted', onMounted)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('shallowRef', shallowRef)
    vi.stubGlobal('useTemplateRef', useTemplateRef)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('navigateTo', navigateTo)
    vi.stubGlobal('useTabTitle', vi.fn())
    vi.stubGlobal('useProjectStore', () => ({ saveForm }))
    vi.stubGlobal('useSupplierStore', () => ({ saveForm: vi.fn() }))
    vi.stubGlobal('useCustomerStore', () => ({ save: vi.fn() }))
    vi.stubGlobal('useCrewStore', () => ({ save: vi.fn() }))
    vi.stubGlobal('useWorkerStore', () => ({ save: vi.fn() }))
    vi.stubGlobal('useTargetCostStore', () => ({ save: vi.fn() }))
    vi.stubGlobal('useMasterDataReadStore', () => ({
      searchCustomers: vi.fn().mockResolvedValue([]),
    }))
    vi.stubGlobal('useTabsStore', () => ({
      tabs: [],
      close: closeTab,
      open: vi.fn(),
    }))
    vi.stubGlobal('useKitUI', () => ({
      confirm,
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    }))
  })

  it('新建态消费统一整页壳且不为短表单保留左侧分区栏', async () => {
    render(MasterDataFormPage, {
      props: { kind: 'project', hideSections: true, returnToDetail: true },
      global: { components: globalComponents },
    })
    await flushPromises()

    expect(screen.getByRole('heading', { name: '新建 · 项目' })).not.toBeNull()
    expect(screen.getByTestId('project-form-shell').dataset.sectionCount).toBe('0')
    expect(screen.getByRole('button', { name: '返回项目列表' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '保存' })).not.toBeNull()
  })

  it('编辑保存把 lookup 的真实客户 ID 交给 store 并返回项目详情', async () => {
    route.fullPath = '/project/form/project-42'
    route.path = '/project/form/project-42'
    route.params = { id: 'project-42' }
    formMocks.loadProjectForm.mockResolvedValue({
      id: 'project-42',
      name: '原项目',
      manager: '原经理',
      customerId: 'customer-old-id',
      secondaryCustomerId: null,
      status: '施工中',
      approvalStatus: 'draft',
    })

    render(MasterDataFormPage, {
      props: { kind: 'project', hideSections: true, returnToDetail: true },
      global: { components: globalComponents },
    })
    await flushPromises()

    await fireEvent.click(screen.getByRole('button', { name: '选择主客户' }))
    await fireEvent.click(screen.getByRole('button', { name: '选择次客户' }))
    await fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await flushPromises()

    expect(saveForm).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'project-42',
        customerId: 'customer-primary-id',
        secondaryCustomerId: 'customer-secondary-id',
      }),
      'save',
      expect.objectContaining({
        add: [],
        removeIds: [],
        restoreIds: [],
      }),
    )
    expect(closeTab).toHaveBeenCalled()
    expect(navigateTo).toHaveBeenCalledWith('/project/project-42')
  })

  it('新建保存进入新项目详情，并保留统一必填校验与保存语义', async () => {
    render(MasterDataFormPage, {
      props: { kind: 'project', hideSections: true, returnToDetail: true },
      global: { components: globalComponents },
    })
    await flushPromises()

    await fireEvent.update(screen.getByRole('textbox', { name: '项目名称' }), '新项目')
    await fireEvent.update(screen.getByRole('textbox', { name: '项目经理' }), '新经理')
    await fireEvent.click(screen.getByRole('button', { name: '选择主客户' }))
    await fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await flushPromises()

    expect(saveForm).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '新项目',
        manager: '新经理',
        customerId: 'customer-primary-id',
      }),
      'save',
      expect.any(Object),
    )
    expect(navigateTo).toHaveBeenCalledWith('/project/project-created-id')
  })

  it('取消时新建返回列表，编辑返回原项目详情', async () => {
    const newView = render(MasterDataFormPage, {
      props: { kind: 'project', hideSections: true, returnToDetail: true },
      global: { components: globalComponents },
    })
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(navigateTo).toHaveBeenLastCalledWith('/project')
    newView.unmount()

    route.fullPath = '/project/form/project-42'
    route.path = '/project/form/project-42'
    route.params = { id: 'project-42' }
    formMocks.loadProjectForm.mockResolvedValue({
      id: 'project-42',
      name: '原项目',
      manager: '原经理',
      customerId: 'customer-old-id',
      status: '施工中',
      approvalStatus: 'draft',
    })

    render(MasterDataFormPage, {
      props: { kind: 'project', hideSections: true, returnToDetail: true },
      global: { components: globalComponents },
    })
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '取消' }))

    await waitFor(() => {
      expect(navigateTo).toHaveBeenLastCalledWith('/project/project-42')
    })
  })
})
