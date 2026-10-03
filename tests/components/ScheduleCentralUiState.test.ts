import { cleanup, render, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, reactive, ref } from 'vue'
import { useScheduleGroupWizard } from '~/composables/useScheduleGroupWizard'
import { useScheduleWorkspace } from '~/composables/useScheduleWorkspace'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: vi.fn() }))

function fixture() {
  const route = reactive({ path: '/schedule', query: { project: 'p1', origin: 'real' } as Record<string, string> })
  const task = { id: 't1', projectId: 'p1', groupId: 'g1', name: '人工交接', plannedStart: '2026-09-01', plannedFinish: '2026-09-04', boqLineIds: [], itemIds: [], hasQty: false, floorPlans: [] }
  const preview = { floorCount: 1, unitCount: 2, itemCount: 1, itemCodes: ['A'], totalQty: 0, quantities: [], blockers: [], buildings: [{ buildingId: 'b1', floorCount: 1, unitCount: 2, typedUnitCount: 2, itemCount: 1, itemCodes: ['A'], totalQty: 0, blockers: [] as string[], quantities: [{ unit: '㎡', value: 0, knownValue: 0, sourceCount: 2, missingCount: 0, unitMissing: false, completeness: 'complete' }] }] }
  const templates = [{ id: 'lib-t1', key: 'one', name: '人工交接', trade: '综合', color: '#555555', durationDays: 4, itemCodes: [], stageCode: '', predecessorKey: null, predecessorDisabled: false }]
  const store = reactive({
    catalog: [{ id: 'p1', origin: 'real', name: '项目1', code: 'P1', groupCount: 1 }, { id: 'p2', origin: 'real', name: '项目2', code: 'P2', groupCount: 0 }],
    snapshot: { id: 'p1', groups: [{ id: 'g1', name: '1栋', tasks: [task], buildingIds: ['b1'] }], dependencies: [], disabledDependencies: [] },
    contracts: [],
    buildings: [{ id: 'b1', name: '1栋' }],
    buildingCoverage: [],
    processTasks: templates,
    processTasksLibraryId: 'lib1',
    processLibraries: [{ id: 'lib1', name: '标准工序', isDefault: true, version: 1, sourceVersion: 'lib:v1', taskCount: 1 }],
    sourceVersion: 's1',
    sessionKey: 'w:a:real',
    origin: 'real',
    canWrite: true,
    saving: false,
    pendingCommand: null as object | null,
    setOrigin: vi.fn(),
    loadCatalog: vi.fn(),
    loadProject: vi.fn(),
    loadContracts: vi.fn(),
    loadBuildings: vi.fn(),
    loadProcessLibraries: vi.fn(),
    loadProcessLibraryTasks: vi.fn().mockResolvedValue(templates),
    previewProvisionalScope: vi.fn().mockResolvedValue(preview),
    createGroup: vi.fn(),
    saveTaskPlan: vi.fn().mockResolvedValue({ conflicts: [] }),
    recheck: vi.fn(),
    recoverPending: vi.fn(),
    previewTaskReschedule: vi.fn().mockReturnValue({ conflicts: [{ dependencyId: 'dep1', predecessorName: '前工序', successorName: '后工序', requiredDate: '2026-09-09' }] }),
  })
  const router = { push: vi.fn(), replace: vi.fn() }
  const kit = { confirm: vi.fn().mockResolvedValue(true), error: vi.fn(), success: vi.fn(), warning: vi.fn(), formModal: vi.fn() }
  const tabs = { close: vi.fn() }
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => router)
  vi.stubGlobal('useScheduleStore', () => store)
  vi.stubGlobal('useKitUI', () => kit)
  vi.stubGlobal('useTabsStore', () => tabs)
  return { store, route, router, kit, task, preview, tabs }
}
function mountHook<T>(hook: () => T): T {
  let value!: T
  render(defineComponent({ setup() {
    value = hook()
    return () => h('div')
  } }))
  return value
}
afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
  vi.unstubAllGlobals()
})

describe('中央排程界面目标与草稿边界', () => {
  it.each([
    { editedDuration: 13, editedEnabled: false, editedAnchor: '2026-09-08' },
    { editedDuration: 21, editedEnabled: true, editedAnchor: '2026-09-12' },
  ])('返回建组刷新新版候选，保留旧版选择与人工 $editedDuration 天草稿', async ({ editedDuration, editedEnabled, editedAnchor }) => {
    const { store } = fixture()
    const visible = ref(true)
    let wizard!: ReturnType<typeof useScheduleGroupWizard>
    const Wizard = defineComponent({ setup() {
      wizard = useScheduleGroupWizard()
      return () => h('div')
    } })
    render(defineComponent({ setup() {
      return () => h(KeepAlive, null, { default: () => visible.value ? h(Wizard) : null })
    } }))
    await waitFor(() => expect(wizard.initialized.value).toBe(true))
    wizard.currentStep.value = 2
    wizard.name.value = '人工保留分组'
    Object.assign(wizard.tasks.value[0]!, { durationDays: editedDuration, enabled: editedEnabled, anchorStart: editedAnchor, predecessorDisabled: true })
    store.loadProcessLibraries.mockImplementationOnce(async () => {
      store.processLibraries.push({ id: 'lib2', name: '标准工序', isDefault: false, version: 2, sourceVersion: 'lib:v2', taskCount: 1 })
    })
    const taskReads = store.loadProcessLibraryTasks.mock.calls.length
    visible.value = false
    await nextTick()
    visible.value = true
    await waitFor(() => expect(wizard.processLibraryOptions.value.map(option => option.key)).toEqual(['lib1', 'lib2']))
    expect(wizard.processLibraryId.value).toBe('lib1')
    expect(wizard.currentStep.value).toBe(2)
    expect(wizard.name.value).toBe('人工保留分组')
    expect(wizard.tasks.value).toEqual([{ templateKey: 'one', enabled: editedEnabled, durationDays: editedDuration, anchorStart: editedAnchor, predecessorKey: null, predecessorDisabled: true }])
    expect(store.loadProcessLibraryTasks).toHaveBeenCalledTimes(taskReads)
  })

  it.each([
    { target: '项目', nextProject: 'p2', nextSession: 'w:a:real' },
    { target: '会话', nextProject: 'p1', nextSession: 'w:other:real' },
  ])('旧请求的晚失败不覆盖新$target错误或人工草稿', async ({ nextProject, nextSession }) => {
    const { store, route } = fixture()
    const wizard = mountHook(useScheduleGroupWizard)
    await waitFor(() => expect(wizard.initialized.value).toBe(true))
    let reject!: (cause: Error) => void
    store.recheck.mockImplementationOnce(() => new Promise<void>((_, rejectRequest) => {
      reject = rejectRequest
    }))
    const rechecking = wizard.recheck()
    route.query.project = nextProject
    store.sessionKey = nextSession
    await waitFor(() => expect(wizard.projectId.value).toBe(nextProject))
    await waitFor(() => expect(wizard.initialized.value).toBe(true))
    wizard.name.value = '新项目人工稿'
    wizard.submitError.value = '新项目当前错误'
    reject(new Error('旧项目迟到失败'))
    await rechecking
    expect(wizard.submitError.value).toBe('新项目当前错误')
    expect(wizard.name.value).toBe('新项目人工稿')
    expect(wizard.projectId.value).toBe(nextProject)
  })

  it('同一目标后发核对成功后，先发请求的晚失败不能恢复旧错误', async () => {
    const { store } = fixture()
    const wizard = mountHook(useScheduleGroupWizard)
    await waitFor(() => expect(wizard.initialized.value).toBe(true))
    let reject!: (cause: Error) => void
    store.recheck.mockImplementationOnce(() => new Promise<void>((_, rejectRequest) => {
      reject = rejectRequest
    }))
    const earlier = wizard.recheck()
    await wizard.recheck()
    reject(new Error('先发请求迟到失败'))
    await earlier
    expect(wizard.submitError.value).toBe('')
  })

  it('已绑定清单按冻结楼层ID精确打开原工序，错配合同与失效楼层不回退', async () => {
    const { store, route } = fixture()
    Object.assign(store.snapshot.groups[0]!, { contractId: 'bound-contract' })
    Object.assign(store.snapshot.groups[0]!.tasks[0]!, { floorPlans: [{ id: 'frozen-floor', taskId: 't1' }] })
    Object.assign(route.query, { group: 'g1', floorPlan: 'frozen-floor', bindingContract: 'bound-contract' })
    const ui = mountHook(() => useScheduleWorkspace({}))
    await waitFor(() => expect(ui.initialized.value).toBe(true))
    expect(ui.selectedTask.value?.id).toBe('t1')
    expect(ui.canWrite.value).toBe(false)
    route.query.bindingContract = 'other-contract'
    await ui.initialize()
    expect(ui.sourceError.value).toContain('绑定合同或原楼层计划身份不匹配')
    expect(ui.selectedTask.value).toBeNull()
    route.query.bindingContract = 'bound-contract'
    route.query.floorPlan = 'missing-floor'
    await ui.initialize()
    expect(ui.sourceError.value).toContain('失效')
    expect(ui.selectedTask.value).toBeNull()
  })
  it('旧库请求迟到不覆盖新的项目与工序草稿', async () => {
    const { store, route } = fixture()
    let release!: (value: unknown) => void
    store.loadProcessLibraryTasks.mockImplementationOnce(() => new Promise((resolve) => {
      release = resolve
    }))
    const wizard = mountHook(useScheduleGroupWizard)
    await waitFor(() => expect(store.loadProcessLibraryTasks).toHaveBeenCalledOnce())
    route.query.project = 'p2'
    await waitFor(() => expect(wizard.initialized.value).toBe(true))
    await waitFor(() => expect(wizard.projectId.value).toBe('p2'))
    wizard.name.value = '新项目人工稿'
    release([{ key: 'obsolete', durationDays: 99 }])
    await nextTick()
    await nextTick()
    expect(wizard.projectId.value).toBe('p2')
    expect(wizard.name.value).toBe('新项目人工稿')
    expect(wizard.tasks.value[0]?.templateKey).toBe('one')
  })

  it('关闭或返回确认取消保稿，确认放弃通过，未决提交不能放弃', async () => {
    const { store, kit } = fixture()
    const wizard = mountHook(useScheduleGroupWizard)
    await waitFor(() => expect(wizard.initialized.value).toBe(true))
    wizard.name.value = '未保存分组'
    kit.confirm.mockResolvedValueOnce(false)
    expect(await wizard.mayLeave()).toBe(false)
    expect(wizard.name.value).toBe('未保存分组')
    kit.confirm.mockResolvedValueOnce(true)
    expect(await wizard.mayLeave()).toBe(true)
    store.pendingCommand = { commandId: 'pending' }
    expect(await wizard.mayLeave()).toBe(false)
    expect(store.pendingCommand).toEqual({ commandId: 'pending' })
  })

  it('未决旧项目切换新项目，原命令保留但旧弹窗不配给新项目', async () => {
    const { store, task, route } = fixture()
    const workspace = mountHook(() => useScheduleWorkspace({}))
    await waitFor(() => expect(workspace.initialized.value).toBe(true))
    workspace.openTask(task as never)
    store.pendingCommand = { commandId: 'pending-project-one' }
    route.query.project = 'p2'
    await workspace.initialize()
    expect(workspace.selectedTask.value).toBeNull()
    expect(workspace.taskDialogOpen.value).toBe(false)
    expect(store.pendingCommand).toEqual({ commandId: 'pending-project-one' })
  })

  it('已提交的旧响应不关闭后来打开的新工序', async () => {
    const { store, task } = fixture()
    store.previewTaskReschedule.mockReturnValue({ conflicts: [] })
    let finish!: (value: { conflicts: never[] }) => void
    store.saveTaskPlan.mockImplementationOnce(() => new Promise((resolve) => {
      finish = resolve
    }))
    const ui = mountHook(() => useScheduleWorkspace({}))
    await waitFor(() => expect(ui.initialized.value).toBe(true))
    ui.openTask(task as never)
    const saving = ui.saveTask({ task: { plannedStart: '2026-09-02', plannedFinish: '2026-09-05' }, floorPlans: [], dependency: null })
    await waitFor(() => expect(store.saveTaskPlan).toHaveBeenCalledOnce())
    ui.openTask({ ...task, id: 'new-task' } as never)
    finish({ conflicts: [] })
    await saving
    expect(ui.selectedTask.value?.id).toBe('new-task')
    expect(ui.taskDialogOpen.value).toBe(true)
  })

  it('未决提交不替换原工序草稿，恢复建组用真实返回ID', async () => {
    const { store, task, router, tabs } = fixture()
    const workspace = mountHook(() => useScheduleWorkspace({}))
    await waitFor(() => expect(workspace.initialized.value).toBe(true))
    workspace.openTask(task as never)
    store.pendingCommand = { commandId: 'original' }
    workspace.openTask({ ...task, id: 'other-task' } as never)
    expect(workspace.selectedTask.value?.id).toBe('t1')
    const wizard = mountHook(useScheduleGroupWizard)
    await waitFor(() => expect(wizard.initialized.value).toBe(true))
    store.recoverPending.mockResolvedValueOnce('created-group')
    await wizard.recoverPending()
    expect(tabs.close).toHaveBeenCalledWith('/schedule/new')
    expect(router.push).toHaveBeenCalledWith({ path: '/schedule', query: { project: 'p1', group: 'created-group', origin: 'real' } })
  })

  it('失效深链不读取首项目或同名来源', async () => {
    const { route, store } = fixture()
    route.query.project = 'missing'
    const ui = mountHook(() => useScheduleWorkspace({}))
    await waitFor(() => expect(ui.initialized.value).toBe(true))
    expect(ui.sourceError.value).toContain('身份不匹配')
    expect(store.loadProject).not.toHaveBeenCalled()
  })

  it('精确日期调期取消不提交，确认携带本次冲突关系', async () => {
    const { store, kit, task } = fixture()
    const ui = mountHook(() => useScheduleWorkspace({}))
    await waitFor(() => expect(ui.initialized.value).toBe(true))
    ui.openTask(task as never)
    const draft = { task: { plannedStart: '2026-09-02', plannedFinish: '2026-09-05' }, floorPlans: [], dependency: null }
    kit.confirm.mockResolvedValueOnce(false)
    await ui.saveTask(draft)
    expect(store.saveTaskPlan).not.toHaveBeenCalled()
    expect(ui.taskDialogOpen.value).toBe(true)
    await ui.saveTask(draft)
    expect(store.saveTaskPlan).toHaveBeenCalledWith('t1', { ...draft, disableDependencyIds: ['dep1'] }, expect.any(String))
  })

  it('确认期间换项目，晚返回的批准不修改新项目', async () => {
    const { store, kit, route, task } = fixture()
    const ui = mountHook(() => useScheduleWorkspace({}))
    await waitFor(() => expect(ui.initialized.value).toBe(true))
    ui.openTask(task as never)
    let approve!: (value: boolean) => void
    kit.confirm.mockImplementationOnce(() => new Promise((resolve) => {
      approve = resolve
    }))
    const saving = ui.saveTask({ task: { plannedStart: '2026-09-02', plannedFinish: '2026-09-05' }, floorPlans: [], dependency: null })
    route.query.project = 'p2'
    await nextTick()
    await nextTick()
    approve(true)
    await saving
    expect(store.saveTaskPlan).not.toHaveBeenCalled()
  })

  it('暂估真实零是可用来源，失败停留确认步骤且保留工序草稿', async () => {
    const { store } = fixture()
    const ui = mountHook(useScheduleGroupWizard)
    await waitFor(() => expect(ui.initialized.value).toBe(true))
    expect(ui.scopeBasis.value).toBe('provisional')
    expect(ui.provisionalBuildingStatus('b1')).toEqual({ label: '1 层 · 2 户 · 1 项 · 0 ㎡', blocked: false })
    await ui.nextStep()
    ui.tasks.value[0]!.durationDays = 9
    await ui.nextStep()
    expect(ui.currentStep.value).toBe(3)
    store.createGroup.mockRejectedValueOnce(new Error('来源已变化'))
    await ui.submit()
    expect(ui.submitError.value).toContain('来源已变化')
    expect(ui.currentStep.value).toBe(3)
    expect(ui.tasks.value[0]!.durationDays).toBe(9)
  })

  it('逐栋检查缺源，另一栋有效不能掩盖本栋缺模板', async () => {
    const { store, preview } = fixture()
    store.buildings.push({ id: 'b2', name: '2栋' })
    preview.buildings.push({ ...preview.buildings[0]!, buildingId: 'b2', blockers: ['有户未关联户型'] })
    const ui = mountHook(useScheduleGroupWizard)
    await waitFor(() => expect(ui.initialized.value).toBe(true))
    await ui.nextStep()
    expect(ui.currentStep.value).toBe(1)
    expect(ui.confirmationBlockers.value).toContain('2栋：有户未关联户型')
    expect(store.createGroup).not.toHaveBeenCalled()
  })
})
