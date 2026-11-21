import type { ScheduleProcessLibraryDetail } from '~/lib/schedule/process-library'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive, shallowRef } from 'vue'
import ScheduleProcessLibraryFormPage from '~/pages/schedule/process-library/_components/ScheduleProcessLibraryFormPage.vue'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: vi.fn() }))
vi.mock('vue-router', async importOriginal => ({ ...await importOriginal<typeof import('vue-router')>(), onBeforeRouteUpdate: vi.fn(), onBeforeRouteLeave: vi.fn() }))

const predecessorName = `基层处理${'非常长的工序名称'.repeat(15)}`
const successorName = `面层施工${'需要明确核对的后置工序'.repeat(12)}`
function detail(id = 'old'): ScheduleProcessLibraryDetail {
  return { id, code: 'interior', name: `精装修-${id}`, description: '', version: 1, isDefault: false, taskCount: 2, usageCount: null, tasks: [
    { id: `${id}-a`, libraryId: id, libraryVersion: 1, key: 'a', name: id === 'old' ? predecessorName : '新来源前置', durationDays: 2, trade: '', color: '#64748b', itemCodes: [], sortOrder: 10, predecessorKey: null, predecessorDisabled: false },
    { id: `${id}-b`, libraryId: id, libraryVersion: 1, key: 'b', name: id === 'old' ? successorName : '新来源后置', durationDays: 2, trade: '', color: '#64748b', itemCodes: [], sortOrder: 20, predecessorKey: 'a', predecessorDisabled: false },
  ] }
}
const Empty = defineComponent({ setup: () => () => h('div') })

async function harness() {
  setActivePinia(createPinia())
  const route = reactive({ path: '/schedule/process-library/form', fullPath: '/schedule/process-library/form?source=old&origin=real', query: { source: 'old', origin: 'real' } })
  const useStore = defineStore(`reorder-${Math.random()}`, () => ({
    loading: shallowRef(false),
    saving: shallowRef(false),
    origin: shallowRef('real'),
    canWrite: shallowRef(true),
    readVersion: shallowRef(null),
    loadLibraries: vi.fn(async () => undefined),
    loadDetail: vi.fn(async (id: string) => detail(id)),
    saveVersion: vi.fn(),
  }))
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
  vi.stubGlobal('useScheduleProcessLibraryStore', () => useStore())
  vi.stubGlobal('useKitUI', () => ({ confirm: vi.fn(async () => false), success: vi.fn(), error: vi.fn() }))
  render(ScheduleProcessLibraryFormPage, { global: { stubs: { ScheduleTemplateGanttEditor: Empty } } })
  await screen.findByLabelText('工序库名称 *')
  return { route }
}
function currentOrder() {
  return screen.getAllByRole('row').slice(1).map(row => (within(row).getByRole('textbox', { name: /名称$/ }) as HTMLInputElement).value)
}

describe('工序库调序关系核对', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('展示完整前置→后置工序及可键盘滚动清单，取消不改变顺序或前置状态', async () => {
    await harness()
    const before = currentOrder()
    await fireEvent.click(screen.getByRole('button', { name: `下移${predecessorName}` }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(`前置：${predecessorName}（a）`)).not.toBeNull()
    expect(within(dialog).getByText(`后置：${successorName}（b）`)).not.toBeNull()
    expect(within(dialog).getByRole('region', { name: '受影响的前置关系，可滚动' }).getAttribute('tabindex')).toBe('0')
    const cancel = within(dialog).getByRole('button', { name: '取消调整' })
    await waitFor(() => expect(document.activeElement).toBe(cancel))
    await fireEvent.click(cancel)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(currentOrder()).toEqual(before)
    expect(screen.getByRole('button', { name: `设置${successorName}前置工序` }).textContent).not.toContain('已置灰')
  })

  it('明确确认后只将受影响关系置灰并保留', async () => {
    await harness()
    await fireEvent.click(screen.getByRole('button', { name: `下移${predecessorName}` }))
    const dialog = await screen.findByRole('dialog')
    await fireEvent.click(within(dialog).getByRole('button', { name: '调整并置灰冲突' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(currentOrder()).toEqual([successorName, predecessorName])
    expect(screen.getByRole('button', { name: `设置${successorName}前置工序` }).textContent).toContain(`${predecessorName}（已置灰）`)
  })

  it('确认前来源已切换时丢弃旧调整，旧按钮迟到也不覆盖新工序', async () => {
    const { route } = await harness()
    await fireEvent.click(screen.getByRole('button', { name: `下移${predecessorName}` }))
    const button = within(await screen.findByRole('dialog')).getByRole('button', { name: '调整并置灰冲突' })
    route.query.source = 'next'
    await screen.findByLabelText('新来源前置名称')
    await fireEvent.click(button)
    expect(currentOrder()).toEqual(['新来源前置', '新来源后置'])
    expect(screen.getByRole('button', { name: '设置新来源后置前置工序' }).textContent).not.toContain('已置灰')
  })
})
