import type { Component } from 'vue'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computed,
  defineComponent,
  h,
  KeepAlive,
  nextTick,
  onMounted,
  reactive,
  ref,
  shallowReactive,
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
import { useProjectPersistentCommandStore } from '~/stores/project-persistent-command'

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

const route = reactive({
  fullPath: '/project/form',
  path: '/project/form',
  params: {} as Record<string, string>,
  query: {} as Record<string, string>,
})
const navigateTo = vi.fn()
const commandSession = {}
const saveForm = vi.fn()
const closeTab = vi.fn()
const confirm = vi.fn()
const hydrateCommandForm = vi.fn()
const revalidateCommandForm = vi.fn()
const deactivateCommandForm = vi.fn()
const startNewProject = vi.fn()
const rebaseCommandForm = vi.fn()
const acceptLatestCommandForm = vi.fn()
const errorToast = vi.fn()
const warningToast = vi.fn()
const downloadOriginal = vi.fn()

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

const stubs: Record<string, Component> = {
  CentralTargetCostFormScreen: EmptyStub,
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
    route.query = {}
    navigateTo.mockReset()
    saveForm.mockReset()
    hydrateCommandForm.mockReset()
    revalidateCommandForm.mockReset().mockResolvedValue({ form: null, context: {} })
    deactivateCommandForm.mockReset()
    startNewProject.mockReset()
    rebaseCommandForm.mockReset()
    acceptLatestCommandForm.mockReset()
    errorToast.mockReset()
    warningToast.mockReset()
    downloadOriginal.mockReset()
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
      createSession: () => commandSession,
      hydrate: hydrateCommandForm,
      revalidate: revalidateCommandForm,
      deactivate: deactivateCommandForm,
      saveForm,
      startNewProject,
      rebase: rebaseCommandForm,
      acceptLatest: acceptLatestCommandForm,
      downloadOriginal,
    }))
    vi.stubGlobal('useSupplierStore', () => ({ saveForm: vi.fn() }))
    vi.stubGlobal('useCustomerStore', () => ({ save: vi.fn() }))
    vi.stubGlobal('useCrewStore', () => ({ save: vi.fn() }))
    vi.stubGlobal('useWorkerStore', () => ({ save: vi.fn() }))
    vi.stubGlobal('useTargetCostStore', () => ({ save: vi.fn() }))
    vi.stubGlobal('useMasterDataReadStore', () => ({
      searchCustomers: vi.fn().mockResolvedValue([]),
    }))
    vi.stubGlobal('useTabsStore', () => ({ registerCloseGuard: () => () => {}, tabs: [], close: closeTab, open: vi.fn() }))
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
      global: { stubs },
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
      global: { stubs },
    })
    await flushPromises()

    await fireEvent.click(screen.getByRole('button', { name: '选择主客户' }))
    await fireEvent.click(screen.getByRole('button', { name: '选择次客户' }))
    await fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await flushPromises()

    expect(saveForm).toHaveBeenCalledWith(
      commandSession,
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
      global: { stubs },
    })
    await flushPromises()

    await fireEvent.update(screen.getByRole('textbox', { name: '项目名称' }), '新项目')
    await fireEvent.update(screen.getByRole('textbox', { name: '项目经理' }), '新经理')
    await fireEvent.click(screen.getByRole('button', { name: '选择主客户' }))
    await fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await flushPromises()

    expect(saveForm).toHaveBeenCalledWith(
      commandSession,
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
      global: { stubs },
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

  it.each([
    { label: '新建', id: null, expected: '/project' },
    { label: '编辑', id: 'project-42', expected: '/project/project-42?origin=real' },
  ])('$label 取消返回 $expected', async ({ id, expected }) => {
    if (id) {
      route.fullPath = `/project/form/${id}`
      route.path = `/project/form/${id}`
      route.params = { id }
      hydrateCommandForm.mockResolvedValue({
        draft: { id, name: '原项目', manager: '原经理', customerId: 'customer-old-id', status: '施工中', approvalStatus: 'draft' },
        attachments: [],
        pendingAttachments: [],
        pendingRemoveIds: [],
        pendingRestoreIds: [],
        restoredLocalDraft: null,
      })
    }

    render(MasterDataFormPage, {
      props: { kind: 'project', hideSections: true, returnToDetail: true },
      global: { stubs },
    })
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '取消' }))

    await waitFor(() => {
      expect(navigateTo).toHaveBeenLastCalledWith(expected)
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
      global: { stubs },
    })
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect((await screen.findByRole('alert')).textContent).toContain('服务器最新版本为 2')
    expect(screen.getByRole('button', { name: '改用服务器最新版' })).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '保留我的内容' }))
    expect(rebaseCommandForm).toHaveBeenCalledWith(commandSession, '2')
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
      global: { stubs },
    })
    await flushPromises()
    await fireEvent.update(screen.getByRole('textbox', { name: '项目名称' }), '断网项目')
    await fireEvent.update(screen.getByRole('textbox', { name: '项目经理' }), '张经理')
    await fireEvent.click(screen.getByRole('button', { name: '选择主客户' }))
    await fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect((await screen.findByRole('status')).textContent).toContain('仅保留本地草稿，未正式保存')
    expect(navigateTo).not.toHaveBeenCalled()
  })

  function formalFixture() {
    setActivePinia(createPinia())
    window.sessionStorage.clear()
    const context = { workspaceId: 'ui-project-workspace', actorId: 'ui-owner', capabilities: ['project:write', 'project:original:write'] }
    let savedForm: { draft: Record<string, unknown> & { id: string }, version: string, updatedAt: string, attachments: [] } | null = null
    const journal = new Map<string, object>()
    const repository = {
      context: vi.fn(async () => context),
      loadForm: vi.fn(async () => savedForm!),
      execute: vi.fn(async (request) => {
        savedForm = { draft: { ...request.draft, id: 'ui-saved-project' }, version: '1', updatedAt: '2026-10-04T08:00:00.000Z', attachments: [] }
        const result = { id: savedForm.draft.id, commandId: request.commandId, version: '1', updatedAt: savedForm.updatedAt, attachmentIds: [] }
        journal.set(request.commandId, result)
        return result
      }),
    }
    const resolve = vi.fn(async (commandId: string) => journal.has(commandId) ? { outcome: 'applied', result: journal.get(commandId) } : { outcome: 'not-applied', commandId, result: null })
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { projectCommands: repository, projectProduction: { resolve } } }))
    const store = useProjectPersistentCommandStore()
    const session = shallowReactive({ storesOriginals: false, persistent: store.createSession() })
    vi.stubGlobal('useProjectCommandStore', () => ({
      createSession: () => session,
      hydrate: (_session, id: string | null) => {
        session.storesOriginals = true
        return store.hydrate(session.persistent, id)
      },
      saveForm: (_session, draft, action, attachments) => store.saveForm(session.persistent, draft, action, attachments),
      recover: () => store.recover(session.persistent),
      revalidate: () => store.revalidate(session.persistent),
      deactivate: () => store.deactivate(session.persistent),
      startNewProject: () => store.startNewProject(session.persistent),
      rebase: (_session, version: string) => store.rebase(session.persistent, version),
      acceptLatest: (_session, form) => store.acceptLatest(session.persistent, form),
    }))
    return { repository, resolve, session }
  }

  it('正式项目可靠回执后读取失败保留输入和原编号，不关闭；只读核对后仍保留后来输入', async () => {
    const { repository, resolve, session } = formalFixture()
    repository.loadForm.mockRejectedValueOnce(new Error('read failed'))
    render(MasterDataFormPage, { props: { kind: 'project', hideSections: true, returnToDetail: true }, global: { stubs } })
    await flushPromises()
    await fireEvent.update(screen.getByRole('textbox', { name: '项目名称' }), '已发出项目')
    await fireEvent.update(screen.getByRole('textbox', { name: '项目经理' }), '发出经理')
    await fireEvent.click(screen.getByRole('button', { name: '选择主客户' }))
    await fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await flushPromises()
    expect(screen.getByRole('status', { name: '原提交恢复' }).textContent).toContain('已保存待刷新')
    expect(session.persistent.pending?.result?.id).toBe('ui-saved-project')
    expect(window.sessionStorage.length).toBe(1)
    expect(navigateTo).not.toHaveBeenCalled()
    expect(closeTab).not.toHaveBeenCalled()
    await fireEvent.update(screen.getByRole('textbox', { name: '项目名称' }), '后来继续编辑')
    await fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(repository.execute).toHaveBeenCalledTimes(1)
    await fireEvent.click(screen.getByRole('button', { name: '重新读取已保存记录' }))
    await flushPromises()
    expect(resolve).not.toHaveBeenCalled()
    expect(repository.loadForm).toHaveBeenCalledTimes(2)
    expect((screen.getByRole('textbox', { name: '项目名称' }) as HTMLInputElement).value).toBe('后来继续编辑')
    expect(window.sessionStorage.length).toBe(0)
    expect(navigateTo).not.toHaveBeenCalled()
    expect(closeTab).not.toHaveBeenCalled()
  })

  it('正式项目保存期间的后来输入不会被成功关闭或保存并新建清掉', async () => {
    const { repository } = formalFixture()
    const execute = repository.execute.getMockImplementation()!
    let release: (() => void) | undefined
    repository.execute.mockImplementationOnce(async (request) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return execute(request)
    })
    render(MasterDataFormPage, { props: { kind: 'project', hideSections: true }, global: { stubs } })
    await flushPromises()
    await fireEvent.update(screen.getByRole('textbox', { name: '项目名称' }), '本次提交')
    await fireEvent.update(screen.getByRole('textbox', { name: '项目经理' }), '合成经理')
    await fireEvent.click(screen.getByRole('button', { name: '选择主客户' }))
    await fireEvent.click(screen.getByRole('button', { name: '保存并新建' }))
    await waitFor(() => expect(release).toBeTypeOf('function'))
    await fireEvent.update(screen.getByRole('textbox', { name: '项目名称' }), '尚未发出的后来输入')
    release!()
    await flushPromises()
    expect(repository.execute.mock.calls[0]?.[0].draft.name).toBe('本次提交')
    expect((screen.getByRole('textbox', { name: '项目名称' }) as HTMLInputElement).value).toBe('尚未发出的后来输入')
    expect(navigateTo).not.toHaveBeenCalled()
    expect(closeTab).not.toHaveBeenCalled()
    expect(warningToast).toHaveBeenCalledWith(expect.stringContaining('继续编辑'))
  })

  it('迟到初始化与保存冲突都不能覆盖已切换的新项目页面', async () => {
    const central = (id: string) => ({ draft: { id, name: id, manager: '经理', customerId: 'customer' }, attachments: [], pendingAttachments: [], pendingRemoveIds: [], pendingRestoreIds: [], restoredLocalDraft: null })
    let releaseRead!: (value: ReturnType<typeof central>) => void
    hydrateCommandForm.mockImplementationOnce(() => new Promise(resolve => releaseRead = resolve)).mockImplementation(async (_session, id) => central(id))
    route.fullPath = route.path = '/project/form/project-a'
    route.params = { id: 'project-a' }
    render(MasterDataFormPage, { props: { kind: 'project' }, global: { stubs } })
    await flushPromises()
    route.fullPath = route.path = '/project/form/project-b'
    route.params = { id: 'project-b' }
    await flushPromises()
    releaseRead(central('project-a'))
    await flushPromises()
    expect((screen.getByRole('textbox', { name: '项目名称' }) as HTMLInputElement).value).toBe('project-b')
    let rejectSave!: (cause: Error) => void
    saveForm.mockImplementationOnce(() => new Promise((_resolve, reject) => rejectSave = reject))
    await fireEvent.click(screen.getByRole('button', { name: '保存' }))
    route.fullPath = route.path = '/project/form/project-c'
    route.params = { id: 'project-c' }
    await flushPromises()
    rejectSave(new Error('旧目标失败'))
    await flushPromises()
    expect((screen.getByRole('textbox', { name: '项目名称' }) as HTMLInputElement).value).toBe('project-c')
    expect(errorToast).not.toHaveBeenCalled()
    expect(closeTab).not.toHaveBeenCalled()
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('页面卸载后迟到的原件字节不能生成下载链接', async () => {
    const file = { id: 'original-a', ownerId: 'project-a', fileName: '原件.txt', fileSize: 3, deletedAt: null }
    hydrateCommandForm.mockResolvedValue({ draft: { id: 'project-a', name: 'A' }, attachments: [file], pendingAttachments: [], pendingRemoveIds: [], pendingRestoreIds: [], restoredLocalDraft: null })
    route.fullPath = route.path = '/project/form/project-a'
    route.params = { id: 'project-a' }
    let release!: (blob: Blob) => void
    downloadOriginal.mockImplementationOnce(() => new Promise(resolve => release = resolve))
    const AttachmentStub = defineComponent({ emits: ['download'], setup: (_props, { emit }) => () => h('button', { onClick: () => emit('download', file) }, '下载原件') })
    const createObjectURL = vi.fn(() => 'blob:synthetic-original')
    vi.stubGlobal('URL', class extends URL { static createObjectURL = createObjectURL })
    const view = render(MasterDataFormPage, { props: { kind: 'project' }, global: { stubs: { ...stubs, MasterDataAttachmentSection: AttachmentStub } } })
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '下载原件' }))
    expect(downloadOriginal).toHaveBeenCalledWith('project-a', 'original-a')
    view.unmount()
    release(new Blob(['abc']))
    await flushPromises()
    expect(createObjectURL).not.toHaveBeenCalled()
  })
  it('页签重新激活只重验原目标，保留未保存输入且不重复 hydrate', async () => {
    hydrateCommandForm.mockResolvedValue({ draft: { id: 'project-1', name: '已保存名称', manager: '张经理', customerId: 'customer-1' }, attachments: [], pendingAttachments: [], pendingRemoveIds: [], pendingRestoreIds: [], restoredLocalDraft: null })
    Object.assign(route, { fullPath: '/project/form/project-1?origin=real', path: '/project/form/project-1', params: { id: 'project-1' }, query: { origin: 'real' } })
    const active = ref(true)
    const host = defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => active.value ? h(MasterDataFormPage, { kind: 'project' }) : null }) })
    render(host, { global: { stubs } })
    await waitFor(() => expect((screen.getByRole('textbox', { name: '项目名称' }) as HTMLInputElement).value).toBe('已保存名称'))
    const input = screen.getByRole('textbox', { name: '项目名称' })
    await fireEvent.update(input, '本页未保存名称')
    active.value = false
    await flushPromises()
    expect(deactivateCommandForm).toHaveBeenCalledTimes(1)
    active.value = true
    await waitFor(() => expect(revalidateCommandForm).toHaveBeenCalledWith(commandSession))
    expect((await screen.findByRole('textbox', { name: '项目名称' }) as HTMLInputElement).value).toBe('本页未保存名称')
    expect(hydrateCommandForm).toHaveBeenCalledTimes(1)
    expect(saveForm).not.toHaveBeenCalled()
  })
})
