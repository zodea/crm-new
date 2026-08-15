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
import { PROJECT_LOCAL_DRAFT_SCHEMA_VERSION } from '~/lib/project/local-draft'
import {
  ProjectCommandConflictError,
  ProjectLocalDraftOnlyError,
} from '~/stores/project-command'

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
const hydrateCommandForm = vi.fn()
const startNewProject = vi.fn()
const rebaseCommandForm = vi.fn()
const acceptLatestCommandForm = vi.fn()
const errorToast = vi.fn()
const warningToast = vi.fn()

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
      h('button', { type: 'button', onClick: () => emit('action', 'saveNew') }, '保存并新建'),
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
  NuxtLink: defineComponent({
    props: { to: { type: String, required: true } },
    setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()),
  }),
}

describe('项目整页表单', () => {
  beforeEach(() => {
    route.fullPath = '/project/form'
    route.path = '/project/form'
    route.params = {}
    navigateTo.mockReset()
    saveForm.mockReset()
    hydrateCommandForm.mockReset()
    startNewProject.mockReset()
    rebaseCommandForm.mockReset()
    acceptLatestCommandForm.mockReset()
    errorToast.mockReset()
    warningToast.mockReset()
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
    hydrateCommandForm.mockResolvedValue({
      draft: null,
      attachments: [],
      pendingAttachments: [],
      pendingRemoveIds: [],
      pendingRestoreIds: [],
      restoredLocalDraft: null,
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
    vi.stubGlobal('useProjectCommandStore', () => ({
      hydrate: hydrateCommandForm,
      saveForm,
      startNewProject,
      rebase: rebaseCommandForm,
      acceptLatest: acceptLatestCommandForm,
    }))
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
      warning: warningToast,
      error: errorToast,
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
    hydrateCommandForm.mockResolvedValue({
      draft: {
        id: 'project-42',
        name: '原项目',
        manager: '原经理',
        customerId: 'customer-old-id',
        secondaryCustomerId: null,
        status: '施工中',
        approvalStatus: 'draft',
      },
      attachments: [],
      pendingAttachments: [],
      pendingRemoveIds: [],
      pendingRestoreIds: [],
      restoredLocalDraft: null,
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
    expect(navigateTo).toHaveBeenCalledWith('/project/project-42?origin=real')
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
    expect(navigateTo).toHaveBeenCalledWith('/project/project-created-id?origin=real')
  })

  it('保存并新建在每次成功后重置中央命令意图并原地重开空表单', async () => {
    render(MasterDataFormPage, {
      props: { kind: 'project', hideSections: true, returnToDetail: true },
      global: { components: globalComponents },
    })
    await flushPromises()

    for (const name of ['第一个项目', '第二个项目']) {
      await fireEvent.update(screen.getByRole('textbox', { name: '项目名称' }), name)
      await fireEvent.update(screen.getByRole('textbox', { name: '项目经理' }), '张经理')
      await fireEvent.click(screen.getByRole('button', { name: '选择主客户' }))
      await fireEvent.click(screen.getByRole('button', { name: '保存并新建' }))
      await flushPromises()
      expect((screen.getByRole('textbox', { name: '项目名称' }) as HTMLInputElement).value).toBe('')
    }

    expect(saveForm).toHaveBeenCalledTimes(2)
    expect(startNewProject).toHaveBeenCalledTimes(2)
    expect(navigateTo).not.toHaveBeenCalled()
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
    hydrateCommandForm.mockResolvedValue({
      draft: {
        id: 'project-42',
        name: '原项目',
        manager: '原经理',
        customerId: 'customer-old-id',
        status: '施工中',
        approvalStatus: 'draft',
      },
      attachments: [],
      pendingAttachments: [],
      pendingRemoveIds: [],
      pendingRestoreIds: [],
      restoredLocalDraft: null,
    })

    render(MasterDataFormPage, {
      props: { kind: 'project', hideSections: true, returnToDetail: true },
      global: { components: globalComponents },
    })
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '取消' }))

    await waitFor(() => {
      expect(navigateTo).toHaveBeenLastCalledWith('/project/project-42?origin=real')
    })
  })

  it('版本冲突时保留本地内容，并由用户显式基于最新版重试', async () => {
    route.fullPath = '/project/form/project-42?origin=real'
    route.path = '/project/form/project-42'
    route.params = { id: 'project-42' }
    hydrateCommandForm.mockResolvedValue({
      draft: { id: 'project-42', name: '我的项目', manager: '张经理', customerId: 'customer-1' },
      attachments: [],
      pendingAttachments: [],
      pendingRemoveIds: [],
      pendingRestoreIds: [],
      restoredLocalDraft: null,
    })
    const latest = {
      draft: { id: 'project-42', name: '服务器最新项目' },
      attachments: [],
      version: '2',
      updatedAt: '2026-08-15T08:00:00.000Z',
    }
    saveForm.mockRejectedValue(new ProjectCommandConflictError(latest, {
      schemaVersion: PROJECT_LOCAL_DRAFT_SCHEMA_VERSION,
      draftId: 'project-draft-1',
      targetProjectId: 'project-42',
      commandId: 'command-1',
      baseVersion: '1',
      action: 'save',
      draft: { id: 'project-42', name: '我的项目' },
      attachments: {},
      updatedAt: '2026-08-15T08:00:00.000Z',
    }))

    render(MasterDataFormPage, {
      props: { kind: 'project', hideSections: true, returnToDetail: true },
      global: { components: globalComponents },
    })
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect((await screen.findByRole('alert')).textContent).toContain('服务器最新版本为 2')
    expect(screen.getByRole('button', { name: '改用服务器最新版' })).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '保留我的内容' }))
    expect(rebaseCommandForm).toHaveBeenCalledWith('2')
    expect(screen.getByRole('status').textContent).toContain('请再次保存')
  })

  it('后台不可用时明确表示只保留本地草稿且未正式保存', async () => {
    saveForm.mockRejectedValue(new ProjectLocalDraftOnlyError({
      schemaVersion: PROJECT_LOCAL_DRAFT_SCHEMA_VERSION,
      draftId: 'project-draft-offline',
      targetProjectId: null,
      commandId: 'command-offline',
      baseVersion: null,
      action: 'save',
      draft: { name: '断网项目' },
      attachments: {},
      updatedAt: '2026-08-15T08:00:00.000Z',
    }))
    render(MasterDataFormPage, {
      props: { kind: 'project', hideSections: true, returnToDetail: true },
      global: { components: globalComponents },
    })
    await flushPromises()
    await fireEvent.update(screen.getByRole('textbox', { name: '项目名称' }), '断网项目')
    await fireEvent.update(screen.getByRole('textbox', { name: '项目经理' }), '张经理')
    await fireEvent.click(screen.getByRole('button', { name: '选择主客户' }))
    await fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect((await screen.findByRole('status')).textContent).toContain('仅保留本地草稿，未正式保存')
    expect(navigateTo).not.toHaveBeenCalled()
  })
})
