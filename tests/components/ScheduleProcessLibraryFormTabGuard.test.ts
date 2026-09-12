import type { ScheduleProcessLibraryDetail } from '~/lib/schedule/process-library'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, shallowRef } from 'vue'
import { createMemoryHistory, createRouter, RouterView, useRoute, useRouter } from 'vue-router'
import ScheduleProcessLibraryFormPage from '~/components/schedule/ScheduleProcessLibraryFormPage.vue'
import { useTabsStore } from '~/stores/tabs'

const detail: ScheduleProcessLibraryDetail = {
  id: 'old',
  code: 'interior',
  name: '精装修',
  description: '',
  version: 1,
  isDefault: false,
  taskCount: 1,
  usageCount: null,
  tasks: [{ id: 'task', libraryId: 'old', libraryVersion: 1, key: 'a', name: '放线', durationDays: 3, trade: '', color: '#64748b', itemCodes: [], sortOrder: 10, predecessorKey: null, predecessorDisabled: false }],
}
const Empty = defineComponent({ setup: () => () => h('div', '其他已打开页签') })

async function harness() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const tabs = useTabsStore()
  const useStore = defineStore(`tab-form-${Math.random()}`, () => ({
    loading: shallowRef(false),
    saving: shallowRef(false),
    origin: shallowRef('real'),
    canWrite: shallowRef(true),
    readVersion: shallowRef(null),
    loadLibraries: vi.fn(async () => undefined),
    loadDetail: vi.fn(async () => detail),
    saveVersion: vi.fn(),
  }))
  const confirm = vi.fn(async () => false)
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/schedule/process-library/form', component: ScheduleProcessLibraryFormPage },
    { path: '/schedule/process-library', component: Empty },
    { path: '/other', component: Empty },
  ] })
  vi.stubGlobal('useRoute', useRoute)
  vi.stubGlobal('useRouter', useRouter)
  vi.stubGlobal('useTabsStore', () => tabs)
  vi.stubGlobal('useScheduleProcessLibraryStore', () => useStore())
  vi.stubGlobal('useKitUI', () => ({ confirm, error: vi.fn(), success: vi.fn() }))
  tabs.open({ fullPath: '/other', title: '其他页签' })
  const formPath = '/schedule/process-library/form?source=old&origin=real'
  tabs.open({ fullPath: formPath, title: '新建工序库版本' })
  router.afterEach(to => tabs.open({ fullPath: to.fullPath, title: to.path }))
  await router.push(formPath)
  await router.isReady()
  const Host = defineComponent({ components: { RouterView, KeepAlive }, template: '<RouterView v-slot="{ Component, route }"><KeepAlive><component :is="Component" :key="route.path" /></KeepAlive></RouterView>' })
  render(Host, { global: { plugins: [pinia, router], components: { ScheduleProcessLibraryTaskEditor: Empty, ScheduleTemplateGanttEditor: Empty } } })
  await screen.findByLabelText('工序库名称 *')
  await fireEvent.update(screen.getByLabelText('工序库名称 *'), '人工未保存稿')
  return { tabs, router, confirm, formPath }
}

describe('工序库真实路由与页签关闭守卫', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('切换已打开页签不询问放弃，返回仍保留草稿；关闭缓存表单才询问', async () => {
    const { tabs, router, confirm, formPath } = await harness()
    tabs.activate('/other')
    await router.push('/other')
    expect(router.currentRoute.value.path).toBe('/other')
    expect(confirm).not.toHaveBeenCalled()
    tabs.activate('/schedule/process-library/form')
    await router.push(formPath)
    const name = await screen.findByLabelText('工序库名称 *')
    expect((name as HTMLInputElement).value).toBe('人工未保存稿')
    expect(confirm).not.toHaveBeenCalled()
    await router.push('/other')
    expect(await tabs.requestClose('/schedule/process-library/form')).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(tabs.tabs.some(tab => tab.key === '/schedule/process-library/form')).toBe(true)
    confirm.mockResolvedValueOnce(true)
    expect(await tabs.requestClose('/schedule/process-library/form')).toBe(true)
    expect(tabs.tabs.some(tab => tab.key === '/schedule/process-library/form')).toBe(false)
  })

  it('返回按钮的取消确认不导航，批准才回列表', async () => {
    const { router, confirm, tabs } = await harness()
    await fireEvent.click(screen.getByRole('button', { name: '返回标准工序库' }))
    expect(router.currentRoute.value.path).toBe('/schedule/process-library/form')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect((screen.getByLabelText('工序库名称 *') as HTMLInputElement).value).toBe('人工未保存稿')
    confirm.mockResolvedValueOnce(true)
    await fireEvent.click(screen.getByRole('button', { name: '返回标准工序库' }))
    await waitFor(() => expect(router.currentRoute.value.path).toBe('/schedule/process-library'))
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(tabs.tabs.some(tab => tab.key === '/schedule/process-library/form')).toBe(false)
    expect(tabs.invalidatedKeys).toContain('/schedule/process-library/form')
  })
})
