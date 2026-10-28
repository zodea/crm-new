import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  computed,
  defineComponent,
  h,
  nextTick,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import ScheduleGroupNewScreen from '~/components/schedule/ScheduleGroupNewScreen.vue'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: vi.fn() }))

vi.mock('~/stores/data-visibility', () => ({ useDataVisibilityStore: () => ({ includeDemo: false }) }))

const NuxtLinkStub = defineComponent({
  setup(_, { slots }) {
    return () => h('a', { href: '#' }, slots.default?.())
  },
})

const SelectFilterStub = defineComponent({
  inheritAttrs: false,
  props: ['options', 'minWidth'],
  setup(_, { attrs }) {
    return () => h('select', attrs)
  },
})

const GanttStub = defineComponent({
  setup() {
    return () => h('div', { 'role': 'grid', 'aria-label': '标准工序模板甘特' })
  },
})

const validProvisionalPreview = {
  floorCount: 1,
  unitCount: 1,
  itemCount: 1,
  itemCodes: ['ITEM-1'],
  totalQty: 10,
  buildings: [{
    buildingId: 'building-1',
    floorCount: 1,
    unitCount: 1,
    typedUnitCount: 1,
    itemCount: 1,
    itemCodes: ['ITEM-1'],
    totalQty: 10,
    quantities: [{ unit: '㎡', value: 10, knownValue: 10, sourceCount: 1, missingCount: 0, unitMissing: false, completeness: 'complete' }],
    blockers: [],
  }],
}

describe('新建排程范围加载保护', () => {
  afterEach(() => {
    window.sessionStorage.clear()
    vi.unstubAllGlobals()
  })

  it('切换范围时禁用下一步，楼栋加载完成后才允许进入第二步', async () => {
    let loadBuildingsCalls = 0
    let resolveProvisionalBuildings: (() => void) | undefined
    let resolveCatalog!: () => void
    const store = {
      catalog: [{ id: 'project-1', origin: 'real', name: '测试项目', code: 'P-01' }],
      contracts: [{ id: 'contract-1', name: '施工合同', no: 'SG-01', lineCount: 1 }],
      processLibraries: [{
        id: 'library-1',
        name: '标准工序',
        version: 1,
        taskCount: 1,
        isDefault: true,
      }],
      processTasks: [{
        key: 'setting-out',
        name: '放线',
        trade: '泥水工',
        color: '#64748b',
        durationDays: 3,
        predecessorKey: null,
        predecessorDisabled: false,
      }],
      processTasksLibraryId: 'library-1',
      buildings: [{ id: 'building-1', name: '1栋', code: 'B1' }],
      buildingCoverage: [{
        id: 'building-1',
        name: '1栋',
        code: 'B1',
        inContract: true,
        scheduled: false,
      }],
      saving: false,
      canWrite: true,
      sessionKey: 'w:a:real',
      setOrigin: vi.fn(),
      recheck: vi.fn(),
      loadCatalog: vi.fn(() => new Promise<void>((resolve) => { resolveCatalog = resolve })),
      loadProcessLibraries: vi.fn().mockResolvedValue(undefined),
      loadProcessLibraryTasks: vi.fn().mockResolvedValue([{
        key: 'setting-out',
        name: '放线',
        trade: '泥水工',
        color: '#64748b',
        durationDays: 3,
        predecessorKey: null,
        predecessorDisabled: false,
      }]),
      loadContracts: vi.fn().mockResolvedValue(undefined),
      previewProvisionalScope: vi.fn().mockResolvedValue(validProvisionalPreview),
      loadBuildings: vi.fn(async () => {
        loadBuildingsCalls += 1
        if (loadBuildingsCalls === 1)
          return
        await new Promise<void>((resolve) => {
          resolveProvisionalBuildings = resolve
        })
      }),
      createGroup: vi.fn(),
    }

    vi.stubGlobal('computed', computed)
    vi.stubGlobal('nextTick', nextTick)
    vi.stubGlobal('onMounted', onMounted)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('shallowRef', shallowRef)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useRoute', () => ({ query: { project: 'project-1' } }))
    vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
    vi.stubGlobal('useScheduleStore', () => store)
    vi.stubGlobal('useKitUI', () => ({
      confirm: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
    }))

    render(ScheduleGroupNewScreen, {
      global: {
        components: {
          NuxtLink: NuxtLinkStub,
          ScheduleTemplateGanttEditor: GanttStub,
          SelectFilter: SelectFilterStub,
        },
      },
    })

    expect(screen.getByLabelText('分组名称').closest('section')?.getAttribute('inert')).toBe('true')
    resolveCatalog()
    const nextStep = await screen.findByRole('button', { name: '下一步：选择工序' })
    await waitFor(() => expect(loadBuildingsCalls).toBe(1))
    await waitFor(() => expect((nextStep as HTMLButtonElement).disabled).toBe(false))

    await fireEvent.click(screen.getByRole('radio', { name: /内部暂估/ }))
    await waitFor(() => expect(loadBuildingsCalls).toBe(2))
    expect((nextStep as HTMLButtonElement).disabled).toBe(true)

    await fireEvent.click(nextStep)
    expect(screen.queryByRole('heading', { name: '调整标准工序' })).toBeNull()

    resolveProvisionalBuildings?.()
    await waitFor(() => expect((nextStep as HTMLButtonElement).disabled).toBe(false))
    await fireEvent.click(nextStep)
    expect(screen.getByRole('heading', { name: '调整标准工序' })).not.toBeNull()
  })

  it('初始化失败时显示页面内错误并可重试恢复向导', async () => {
    const loadCatalog = vi.fn()
      .mockRejectedValueOnce(new Error('catalog offline'))
      .mockResolvedValue(undefined)
    const store = {
      catalog: [{ id: 'project-1', origin: 'real', name: '测试项目', code: 'P-01' }],
      contracts: [],
      processLibraries: [{
        id: 'library-1',
        name: '标准工序',
        version: 1,
        taskCount: 1,
        isDefault: true,
      }],
      processTasks: [{
        key: 'setting-out',
        name: '放线',
        trade: '泥水工',
        color: '#64748b',
        durationDays: 3,
        predecessorKey: null,
        predecessorDisabled: false,
      }],
      processTasksLibraryId: 'library-1',
      buildings: [{ id: 'building-1', name: '1栋', code: 'B1' }],
      buildingCoverage: [],
      saving: false,
      canWrite: true,
      sessionKey: 'w:a:real',
      setOrigin: vi.fn(),
      recheck: vi.fn(),
      loadCatalog,
      loadProcessLibraries: vi.fn().mockResolvedValue(undefined),
      loadProcessLibraryTasks: vi.fn().mockResolvedValue([{
        key: 'setting-out',
        name: '放线',
        trade: '泥水工',
        color: '#64748b',
        durationDays: 3,
        predecessorKey: null,
        predecessorDisabled: false,
      }]),
      loadContracts: vi.fn().mockResolvedValue(undefined),
      previewProvisionalScope: vi.fn().mockResolvedValue(validProvisionalPreview),
      loadBuildings: vi.fn().mockResolvedValue(undefined),
      createGroup: vi.fn(),
    }

    vi.stubGlobal('computed', computed)
    vi.stubGlobal('nextTick', nextTick)
    vi.stubGlobal('onMounted', onMounted)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('shallowRef', shallowRef)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useRoute', () => ({ query: { project: 'project-1' } }))
    vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
    vi.stubGlobal('useScheduleStore', () => store)
    vi.stubGlobal('useKitUI', () => ({
      confirm: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
    }))

    render(ScheduleGroupNewScreen, {
      global: {
        components: {
          NuxtLink: NuxtLinkStub,
          ScheduleTemplateGanttEditor: GanttStub,
          SelectFilter: SelectFilterStub,
        },
      },
    })

    expect((await screen.findByRole('alert')).textContent).toContain('catalog offline')
    await fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await waitFor(() => expect(loadCatalog).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('navigation', { name: '新建排程步骤' })).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('区域草稿在异步恢复失败时保留，重试成功后恢复并提示失效楼栋', async () => {
    const draft = {
      projectId: 'project-1',
      contractId: '',
      scopeBasis: 'provisional',
      processLibraryId: 'library-1',
      name: '区域返回草稿',
      startDate: '2026-08-01',
      overlapMode: 'half',
      buildingIds: ['building-1', 'building-removed'],
      tasks: [{
        templateKey: 'setting-out',
        enabled: true,
        durationDays: 5,
        anchorStart: null,
        predecessorKey: null,
        predecessorDisabled: false,
      }],
    }
    const draftKey = 'ruihang:schedule-region-drafts'
    const draftIdentity = 'w:a:real:real:project-1'
    window.sessionStorage.setItem(draftKey, JSON.stringify({ [draftIdentity]: draft }))
    const loadProcessLibraryTasks = vi.fn()
      .mockRejectedValueOnce(new Error('process library offline'))
      .mockResolvedValue([{
        key: 'setting-out',
        name: '放线',
        trade: '泥水工',
        color: '#64748b',
        durationDays: 3,
        predecessorKey: null,
        predecessorDisabled: false,
      }])
    const warning = vi.fn()
    const store = {
      catalog: [{ id: 'project-1', origin: 'real', name: '测试项目', code: 'P-01' }],
      contracts: [],
      processLibraries: [{
        id: 'library-1',
        name: '标准工序',
        version: 1,
        taskCount: 1,
        isDefault: true,
      }],
      processTasks: [{
        key: 'setting-out',
        name: '放线',
        trade: '泥水工',
        color: '#64748b',
        durationDays: 3,
        predecessorKey: null,
        predecessorDisabled: false,
        itemCodes: [],
      }],
      processTasksLibraryId: 'library-1',
      buildings: [{ id: 'building-1', name: '1栋', code: 'B1' }],
      buildingCoverage: [],
      saving: false,
      canWrite: true,
      sessionKey: 'w:a:real',
      setOrigin: vi.fn(),
      recheck: vi.fn(),
      loadCatalog: vi.fn().mockResolvedValue(undefined),
      loadProcessLibraries: vi.fn().mockResolvedValue(undefined),
      loadProcessLibraryTasks,
      loadContracts: vi.fn().mockResolvedValue(undefined),
      previewProvisionalScope: vi.fn().mockResolvedValue(validProvisionalPreview),
      loadBuildings: vi.fn().mockResolvedValue(undefined),
      createGroup: vi.fn(),
    }

    vi.stubGlobal('computed', computed)
    vi.stubGlobal('nextTick', nextTick)
    vi.stubGlobal('onMounted', onMounted)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('shallowRef', shallowRef)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useRoute', () => ({ query: { project: 'project-1', resume: 'region' } }))
    vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
    vi.stubGlobal('useScheduleStore', () => store)
    vi.stubGlobal('useKitUI', () => ({
      confirm: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
      warning,
    }))

    render(ScheduleGroupNewScreen, {
      global: {
        components: {
          NuxtLink: NuxtLinkStub,
          ScheduleTemplateGanttEditor: GanttStub,
          SelectFilter: SelectFilterStub,
        },
      },
    })

    expect((await screen.findByRole('alert')).textContent).toContain('process library offline')
    expect(window.sessionStorage.getItem(draftKey)).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '重新加载' }))

    await waitFor(() => {
      expect((screen.getByLabelText('分组名称') as HTMLInputElement).value).toBe('区域返回草稿')
    })
    expect(window.sessionStorage.getItem(draftKey)).toBeNull()
    await waitFor(() => expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('已从排程范围移除 1 栋失效楼栋'),
    ))
  })
})
