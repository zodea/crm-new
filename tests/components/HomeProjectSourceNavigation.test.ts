import type { ProjectListSourceRow } from '~/lib/project/repository'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter, RouterLink, useRoute, useRouter } from 'vue-router'
import HomeDashboard from '~/components/home/HomeDashboard.vue'
import HomeDashboardSurface from '~/components/home/HomeDashboardSurface.vue'
import HomeScheduleSourceScreen from '~/components/schedule/HomeScheduleSourceScreen.vue'
import StatePanel from '~/components/ui/StatePanel.vue'
import { createHttpProjectListRepository } from '~/lib/project/http-repository'
import { projectProblem, ProjectRepositoryProblem } from '~/lib/project/repository'
import { createProjectReadTestInstance, PROJECT_READ_FIXTURE } from '../../server/utils/project-read-test-instance'
import { fixtureProjectCustomerReferences } from '../helpers/project-read-meta'

vi.mock('~/lib/db/connection', () => ({ select: () => {
  throw new Error('正式项目不得回读旧本地库')
} }))
vi.mock('~/lib/platform/runtime', () => ({ isDesktopRuntime: () => false }))

const ProjectSwitcher = defineComponent({
  props: ['modelValue', 'projects'],
  emits: ['update:modelValue'],
  template: '<select aria-label="选择首页项目" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option></select>',
})

let beforeRead: (id: string) => Promise<void>
let rows: ProjectListSourceRow[]
let instance: ReturnType<typeof createProjectReadTestInstance>

beforeEach(() => {
  beforeRead = async () => {}
  rows = ['a', 'b'].map(id => ({ ...PROJECT_READ_FIXTURE[0]!, id, name: `中央项目 ${id}`, dataOrigin: 'real' }))
  instance = createProjectReadTestInstance(() => ['project:list:read'], () => rows, () => 'v1', undefined, async () => 0, async () => [], fixtureProjectCustomerReferences)
  const repository = createHttpProjectListRepository({ fetcher: async (url, options) => {
    if (url === '/api/read/projects')
      return instance.list(options?.query)
    const id = decodeURIComponent(url.split('/').at(-1)!)
    await beforeRead(id)
    return instance.detail(id, options?.query)
  } })
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { projectList: repository } }))
  vi.stubGlobal('useRoute', useRoute)
  vi.stubGlobal('useRouter', useRouter)
  vi.stubGlobal('useKitUI', () => ({ error: vi.fn(), warning: vi.fn() }))
})
afterEach(() => vi.unstubAllGlobals())

async function open(location = '/') {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: HomeDashboard },
    { path: '/schedule', component: HomeScheduleSourceScreen },
    { path: '/project', component: defineComponent({ template: '<div />' }) },
  ] })
  await router.push(location)
  const shell = defineComponent({ template: '<RouterView v-slot="{ Component }"><KeepAlive><component :is="Component" /></KeepAlive></RouterView>' })
  const wrapper = mount(shell, { global: {
    plugins: [createPinia(), router],
    components: { NuxtLink: RouterLink, ProjectSwitcher, HomeDashboardSurface, StatePanel },
    stubs: { HomeScheduleOverview: true },
  } })
  await flushPromises()
  return { router, wrapper }
}

describe('首页中央项目与施工进度来源导航', () => {
  it('离开首页后迟到的项目读取不得改写新页面地址', async () => {
    const { wrapper, router } = await open()
    let release!: () => void
    beforeRead = id => id === 'b'
      ? new Promise((resolve) => {
          release = resolve
        })
      : Promise.resolve()
    await wrapper.get('select').setValue('real:b')
    await flushPromises()
    await router.push('/project')
    await flushPromises()
    release()
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/project')
    wrapper.unmount()
  })

  it('本地无项目仍可选择中央新项目，查看来源后返回同一身份并回读更名', async () => {
    const { wrapper, router } = await open()
    expect(wrapper.get('select').text()).toContain('中央项目 b')
    await wrapper.get('select').setValue('real:b')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ project: 'b', origin: 'real' })
    expect(wrapper.text()).toContain('中央项目 b的排程来源尚未接入')
    await wrapper.get('a[href^="/schedule"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('计划与实际进度未知')
    expect(wrapper.find('[data-home-schedule-source]').exists()).toBe(true)
    rows[1]!.name = '中央已更名'
    await wrapper.get('a[href^="/?project="]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ project: 'b', origin: 'real' })
    expect(wrapper.text()).toContain('中央已更名的排程来源尚未接入')
    wrapper.unmount()
  })

  it('快速切换以最后一次选择为准，迟到响应不覆盖项目或地址', async () => {
    const { wrapper, router } = await open()
    let release!: () => void
    beforeRead = id => id === 'b'
      ? new Promise((resolve) => {
          release = resolve
        })
      : Promise.resolve()
    await wrapper.get('select').setValue('real:b')
    await flushPromises()
    await wrapper.get('select').setValue('real:a')
    await flushPromises()
    release()
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ project: 'a', origin: 'real' })
    expect(wrapper.text()).toContain('中央项目 a的排程来源尚未接入')
    wrapper.unmount()
  })

  it.each(['unavailable', 'relationship-mismatch'] as const)('切换失败 %s 保留其他可读项目和地址，重试后确认目标项目', async (code) => {
    const { wrapper, router } = await open()
    beforeRead = async (id) => {
      if (id === 'b')
        throw new ProjectRepositoryProblem(projectProblem(code, '读取中断', true))
    }
    await wrapper.get('select').setValue('real:b')
    await flushPromises()
    expect(wrapper.text()).toContain('项目读取失败，已保留当前项目')
    expect(router.currentRoute.value.query.project).toBe('a')
    beforeRead = async () => {}
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.project).toBe('b')
    wrapper.unmount()
  })

  it('当前项目重新读取时来源关系失配，撤下旧事实后仍可选择其他项目', async () => {
    const { wrapper, router } = await open()
    expect(wrapper.text()).toContain('中央项目 a的排程来源尚未接入')
    await router.push('/project')
    beforeRead = async (id) => {
      if (id === 'a')
        throw new ProjectRepositoryProblem(projectProblem('relationship-mismatch', '项目来源关系已失效'))
    }
    await router.push('/?project=a&origin=real')
    await flushPromises()
    expect(wrapper.text()).toContain('首页施工进度加载失败')
    expect(wrapper.text()).toContain('项目来源关系已失效')
    expect(wrapper.text()).not.toContain('中央项目 a的排程来源尚未接入')
    expect(wrapper.find('a[href^="/schedule"]').exists()).toBe(false)
    await wrapper.get('select').setValue('real:b')
    await flushPromises()
    expect(wrapper.text()).toContain('中央项目 b的排程来源尚未接入')
    expect(router.currentRoute.value.query).toMatchObject({ project: 'b', origin: 'real' })
    wrapper.unmount()
  })

  it('不存在的中央身份及无权限不回落本地或第一项目', async () => {
    const { wrapper, router } = await open('/?project=missing&origin=real')
    expect(wrapper.text()).toContain('指定项目不存在、来源不匹配或当前不可查看')
    expect(router.currentRoute.value.query.project).toBe('missing')
    instance.reset('forbidden')
    await router.push('/schedule?project=a&origin=real')
    await flushPromises()
    expect(wrapper.text()).toContain('当前无权查看项目施工进度')
    expect(wrapper.text()).not.toContain('计划与实际进度未知')
    wrapper.unmount()
  })
})
