import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, onMounted, reactive, shallowRef, watch } from 'vue'
import QuantityScreen from '~/components/quantity/QuantityScreen.vue'

const databaseRead = vi.hoisted(() => vi.fn(() => {
  throw new Error('浏览器不得直读 SQLite')
}))
vi.mock('~/lib/db/client', () => ({ db: { select: databaseRead } }))
const route = reactive({ path: '/subcontract/quantity', query: { project: 'same', origin: 'real' } })
const router = { push: vi.fn(), replace: vi.fn() }
const confirm = vi.fn()
const exportFile = vi.fn()
const scheduleStore = { loadProject: vi.fn(), snapshot: null }
const snapshot = () => ({ projectId: 'same', matrixArchivedAt: null, buildings: [], floors: [], units: [], stages: [], assignments: [], completions: [] })
let store: ReturnType<typeof createStore>
function createStore() {
  const result = reactive({
    catalog: [{ id: 'same', name: '正式项目', code: 'R', dataOrigin: 'real', hasQuantityData: null }, { id: 'same', name: '演示项目', code: 'D', dataOrigin: 'demo', hasQuantityData: true }],
    snapshot: snapshot(),
    stageProgress: [],
    loading: false,
    error: '',
    canWrite: true,
    dataOrigin: 'real',
    loadCatalog: vi.fn().mockResolvedValue(undefined),
    loadProject: vi.fn(async (_id: string, origin: string) => {
      result.canWrite = origin === 'real'
      result.dataOrigin = origin
      result.snapshot = snapshot()
    }),
    cancelProject: vi.fn(),
    archiveMatrix: vi.fn().mockResolvedValue('archive-log'),
    unarchiveMatrix: vi.fn().mockResolvedValue('unarchive-log'),
    readExportWorkspace: vi.fn(),
  })
  return result
}
beforeEach(() => {
  store = createStore()
  route.query = { project: 'same', origin: 'real' }
  router.push.mockClear()
  databaseRead.mockClear()
  confirm.mockReset()
  exportFile.mockReset()
  scheduleStore.loadProject.mockReset()
  for (const [name, value] of Object.entries({ computed, shallowRef, watch, onMounted, useRoute: () => route, useRouter: () => router, useQuantityStore: () => store, useScheduleStore: () => scheduleStore, useProductionAccessStore: () => ({ status: { mode: 'production' } }), useKitUI: () => ({ confirm, exportFile, error: vi.fn(), success: vi.fn(), warning: vi.fn() }) }))
    vi.stubGlobal(name, value)
})
afterEach(() => {
  expect(scheduleStore.loadProject).not.toHaveBeenCalled()
})
const Toolbar = defineComponent({ props: ['projectId', 'projectOptions', 'canWrite'], emits: ['update:projectId', 'manageStages', 'toggleArchive', 'exportByCategory'], template: `<div><select aria-label="项目" :value="projectId" @change="$emit('update:projectId', $event.target.value)"><option v-for="option in projectOptions" :key="option.key" :value="option.key">{{ option.label }}</option></select><button @click="$emit('manageStages')">阶段配置</button><button @click="$emit('toggleArchive')">归档矩阵</button><button @click="$emit('exportByCategory')">分类导出</button></div>` })
function open() {
  return render(QuantityScreen, { global: { stubs: { QuantityToolbar: Toolbar, QuantityProgressCards: true, QuantityWorkspace: true, QuantityAssignmentDialog: true, QuantityCompletionDialog: true, QuantityBatchCompletionDialog: true, QuantityVarianceDialog: true, NuxtLink: true, KitButton: { template: '<button><slot /></button>' } } } })
}

describe('正式工程量矩阵来源与入口', () => {
  it('分类导出准备中切换项目，新目录尚未返回也不打开旧配置', async () => {
    let resolveRead!: (value: unknown) => void
    let resolveCatalog!: () => void
    store.readExportWorkspace.mockReturnValue(new Promise((resolve) => {
      resolveRead = resolve
    }))
    open()
    await waitFor(() => expect(store.loadProject).toHaveBeenCalledWith('same', 'real'))
    store.loadCatalog.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveCatalog = resolve
    }))
    await fireEvent.click(screen.getByRole('button', { name: '分类导出' }))
    expect(store.readExportWorkspace).toHaveBeenCalledWith('same', 'real')
    route.query = { project: 'other', origin: 'real' }
    await waitFor(() => expect(store.loadCatalog).toHaveBeenCalledTimes(2))
    resolveRead({ records: [{ unitId: 'u', unitName: '101户', floorName: '1层', buildingName: '旧项目楼栋', trade: '泥水工', stageName: '基层', status: 'completed', completedAt: '2026-09-12', photoCount: 1, executionAssigneeName: '合成班组' }] })
    await flushPromises()
    expect(exportFile).not.toHaveBeenCalled()
    resolveCatalog()
  })

  it('路由已切换且新目录仍在读取时，旧归档确认不得写入', async () => {
    let resolveConfirmation!: (value: boolean) => void
    let resolveCatalog!: () => void
    confirm.mockReturnValue(new Promise<boolean>((resolve) => {
      resolveConfirmation = resolve
    }))
    open()
    await waitFor(() => expect(store.loadProject).toHaveBeenCalledWith('same', 'real'))
    store.loadCatalog.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveCatalog = resolve
    }))
    await fireEvent.click(screen.getByRole('button', { name: '归档矩阵' }))
    route.query = { project: 'other', origin: 'real' }
    await waitFor(() => expect(store.loadCatalog).toHaveBeenCalledTimes(2))
    resolveConfirmation(true)
    await Promise.resolve()
    expect(store.archiveMatrix).not.toHaveBeenCalled()
    resolveCatalog()
  })

  it('归档确认等待期间切换项目，迟到确认不得归档另一个项目', async () => {
    store.catalog.push({ id: 'other', name: '另一正式项目', code: 'B', dataOrigin: 'real', hasQuantityData: null })
    let resolveConfirmation!: (value: boolean) => void
    confirm.mockReturnValue(new Promise<boolean>((resolve) => {
      resolveConfirmation = resolve
    }))
    open()
    await waitFor(() => expect(store.loadProject).toHaveBeenCalledWith('same', 'real'))
    await fireEvent.click(screen.getByRole('button', { name: '归档矩阵' }))
    expect(confirm).toHaveBeenCalledOnce()
    route.query = { project: 'other', origin: 'real' }
    await waitFor(() => expect(store.loadProject).toHaveBeenLastCalledWith('other', 'real'))
    resolveConfirmation(true)
    await Promise.resolve()
    expect(store.archiveMatrix).not.toHaveBeenCalled()
  })

  it('归档确认仍属于当前已读取项目时可以保存', async () => {
    confirm.mockResolvedValue(true)
    open()
    await waitFor(() => expect(store.loadProject).toHaveBeenCalledWith('same', 'real'))
    await fireEvent.click(screen.getByRole('button', { name: '归档矩阵' }))
    await waitFor(() => expect(store.archiveMatrix).toHaveBeenCalledExactlyOnceWith('same'))
  })

  it('同ID正式和演示项目可分别选择，阶段导航携带来源', async () => {
    open()
    await waitFor(() => expect(store.loadProject).toHaveBeenCalledWith('same', 'real'))
    const select = screen.getByRole('combobox', { name: '项目' }) as HTMLSelectElement
    expect(new Set([...select.options].map(option => option.value)).size).toBe(2)
    await fireEvent.update(select, [...select.options].find(option => option.text.includes('演示项目'))!.value)
    await waitFor(() => expect(store.loadProject).toHaveBeenLastCalledWith('same', 'demo'))
    expect(screen.getByText(/演示工程量只读/)).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: '阶段配置' }))
    expect(router.push).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/subcontract/quantity/stages', query: expect.objectContaining({ project: 'same', origin: 'demo' }) }))
    expect(databaseRead).not.toHaveBeenCalled()
  })
})
