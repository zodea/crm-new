import type { TestDb } from '../helpers/memory-db'
import { fireEvent, screen } from '@testing-library/vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, shallowRef } from 'vue'
import { createMemoryHistory, createRouter, RouterLink, useRoute } from 'vue-router'
import PayrollStatementDetailScreen from '~/components/payroll/PayrollStatementDetailScreen.vue'
import SignedDayworkEntryForm from '~/components/payroll/SignedDayworkEntryForm.vue'
import SignedDayworkScreen from '~/components/payroll/SignedDayworkScreen.vue'
import SignedDayworkTable from '~/components/payroll/SignedDayworkTable.vue'
import SignedDayworkToolbar from '~/components/payroll/SignedDayworkToolbar.vue'
import EntityDetailShell from '~/components/ui/EntityDetailShell.vue'
import Metric from '~/components/ui/Metric.vue'
import MetricGrid from '~/components/ui/MetricGrid.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import { runMigrations } from '~/lib/db/migrations'
import { createWageStatementDraft } from '~/lib/payroll/statements'
import { usePayrollStatementDetailStore } from '~/stores/payroll-statement-detail'
import { useSignedDayworkStore } from '~/stores/signed-daywork'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb
vi.mock('~/lib/db/connection', () => ({ getDb: () => Promise.resolve(db), withTransaction: vi.fn() }))

const query = { project: 'project-b', month: '2025-11', crew: 'crew-b', status: '["draft","checked"]' }

beforeEach(async () => {
  db = await createMemoryDb()
  await runMigrations(db)
  await db.execute('INSERT INTO projects (id, name, code) VALUES (\'project-a\', \'A 项目\', \'PA\'), (\'project-b\', \'B 项目\', \'PB\')')
  await db.execute('INSERT INTO crews (id, name, trade) VALUES (\'crew-b\', \'测试班组\', \'泥水工\')')
  await db.execute('INSERT INTO workers (id, crew_id, name, trade, current_project_id) VALUES (\'worker-b\', \'crew-b\', \'测试工人\', \'泥水工\', \'project-b\')')
  vi.stubGlobal('useRoute', useRoute)
  vi.stubGlobal('useSignedDayworkStore', useSignedDayworkStore)
  vi.stubGlobal('usePayrollStatementDetailStore', usePayrollStatementDetailStore)
  vi.stubGlobal('useTabTitle', () => {})
  vi.stubGlobal('useKitUI', () => ({ success: vi.fn(), error: vi.fn() }))
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('shallowRef', shallowRef)
})

afterEach(() => {
  db.close()
  vi.unstubAllGlobals()
})

describe('工资跨页筛选恢复', () => {
  it('独立 C1 详情显示考勤来源，并返回原四项筛选', async () => {
    const id = await createWageStatementDraft(db, {
      projectId: 'project-b',
      crewId: 'crew-b',
      leaderWorkerId: 'worker-b',
      month: '2025-11',
      purpose: 'advance',
      formatFamily: 'C1',
      periodKind: 'monthly',
      quantitySource: 'field',
      payRatio: 1,
      lines: [{ workerId: 'worker-b', itemName: '正常工时', unit: '天', quantity: 1, unitPrice: 400 }],
    })
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/subcontract/payroll/:id', component: defineComponent({ template: '<div />' }) },
      { path: '/subcontract/payroll', component: defineComponent({ template: '<div />' }) },
    ] })
    await router.push({ path: `/subcontract/payroll/${id}`, query })
    const wrapper = mount(PayrollStatementDetailScreen, {
      global: { plugins: [createPinia(), router], components: {
        NuxtLink: RouterLink,
        EntityDetailShell,
        Metric,
        MetricGrid,
        SectionHeader,
      }, stubs: { MoneyLink: true, PayrollStatementMembersTable: true, PayrollStatementLinesTable: true, PayrollStatementDayworkTable: true } },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('真实考勤')
    expect(wrapper.text()).not.toContain('现场复核量')
    const backLink = wrapper.get('a[aria-label="返回工资核算"]')
    expect(Object.fromEntries(new URL(backLink.attributes('href'), 'http://test').searchParams)).toEqual(query)
    wrapper.unmount()
  })

  it('签工恢复来源范围，签工状态变化后仍带原工资状态返回', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) },
    ] })
    await router.push({ path: '/subcontract/daywork', query })
    const wrapper = mount(SignedDayworkScreen, {
      global: { plugins: [createPinia(), router], components: {
        NuxtLink: RouterLink,
        SignedDayworkEntryForm,
        SignedDayworkToolbar,
        SignedDayworkTable,
      } },
    })
    await flushPromises()
    const toolbar = wrapper.get('[aria-label="签工筛选"]')
    expect((toolbar.findAll('select')[0]!.element as HTMLSelectElement).value).toBe('project-b')
    expect((toolbar.get('input[type="month"]').element as HTMLInputElement).value).toBe('2025-11')
    expect((toolbar.findAll('select')[1]!.element as HTMLSelectElement).value).toBe('crew-b')
    const returnLink = wrapper.findAll('a').find(link => link.text() === '返回工资核算')!
    expect(new URL(returnLink.attributes('href'), 'http://test').searchParams.get('status')).toBe(query.status)
    await toolbar.get('button[aria-label="确认状态，已选 0 项"]').trigger('click')
    await fireEvent.click(await screen.findByRole('checkbox', { name: '已确认' }))
    await fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await flushPromises()
    expect(new URL(returnLink.attributes('href'), 'http://test').searchParams.get('status')).toBe(query.status)
    await toolbar.get('input[type="month"]').setValue('2025-12')
    await flushPromises()
    const updated = new URL(returnLink.attributes('href'), 'http://test')
    expect(Object.fromEntries(updated.searchParams)).toEqual({ ...query, month: '2025-12' })
    wrapper.unmount()
  })

  it('签工丢弃不存在的项目、班组及无效月份和工资状态', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) },
    ] })
    await router.push({ path: '/subcontract/daywork', query: { project: 'missing', crew: 'missing', month: '2025-99', status: 'confirmed' } })
    const wrapper = mount(SignedDayworkScreen, {
      global: { plugins: [createPinia(), router], components: {
        NuxtLink: RouterLink,
        SignedDayworkEntryForm,
        SignedDayworkToolbar,
        SignedDayworkTable,
      } },
    })
    await flushPromises()
    const returnLink = wrapper.findAll('a').find(link => link.text() === '返回工资核算')!
    const returned = new URL(returnLink.attributes('href'), 'http://test').searchParams
    expect(returned.get('project')).toBe('project-a')
    expect(returned.has('crew')).toBe(false)
    expect(returned.has('status')).toBe(false)
    expect(returned.get('month')).not.toBe('2025-99')
    wrapper.unmount()
  })

  it('缓存签工同来源切回保留未保存输入，新来源应用项目月份和工资状态', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/subcontract/daywork', component: SignedDayworkScreen },
      { path: '/subcontract/payroll', component: defineComponent({ template: '<div>工资台账</div>' }) },
      { path: '/subcontract/attendance', component: defineComponent({ template: '<div>考勤</div>' }) },
    ] })
    await router.push({ path: '/subcontract/daywork', query })
    const wrapper = mount(defineComponent({
      template: '<RouterView v-slot="{ Component }"><KeepAlive><component :is="Component" /></KeepAlive></RouterView>',
    }), {
      global: { plugins: [createPinia(), router], components: {
        NuxtLink: RouterLink,
        SignedDayworkEntryForm,
        SignedDayworkToolbar,
        SignedDayworkTable,
      } },
    })
    await flushPromises()
    await wrapper.get('input[placeholder="如：王工"]').setValue('未保存证明人')
    await router.push('/subcontract/payroll')
    await router.push({ path: '/subcontract/daywork', query })
    await flushPromises()
    expect((wrapper.get('input[placeholder="如：王工"]').element as HTMLInputElement).value).toBe('未保存证明人')
    await router.push('/subcontract/payroll')
    await router.push('/subcontract/daywork')
    await flushPromises()
    const cachedLink = wrapper.findAll('a').find(link => link.text() === '返回工资核算')!
    expect(new URL(cachedLink.attributes('href'), 'http://test').searchParams.get('status')).toBe(query.status)
    await router.push('/subcontract/payroll')
    await router.push({ path: '/subcontract/daywork', query: { project: query.project, month: query.month } })
    await flushPromises()
    expect((wrapper.get('[aria-label="签工筛选"]').findAll('select')[1]!.element as HTMLSelectElement).value).toBe('')
    const clearedLink = wrapper.findAll('a').find(link => link.text() === '返回工资核算')!
    expect(Object.fromEntries(new URL(clearedLink.attributes('href'), 'http://test').searchParams)).toEqual({ project: query.project, month: query.month })
    await router.push('/subcontract/payroll')
    const changed = { ...query, project: 'project-a', month: '2025-12', status: 'released' }
    await router.push({ path: '/subcontract/daywork', query: changed })
    await flushPromises()
    const toolbar = wrapper.get('[aria-label="签工筛选"]')
    expect((toolbar.findAll('select')[0]!.element as HTMLSelectElement).value).toBe('project-a')
    expect((toolbar.get('input[type="month"]').element as HTMLInputElement).value).toBe('2025-12')
    const returnLink = wrapper.findAll('a').find(link => link.text() === '返回工资核算')!
    expect(Object.fromEntries(new URL(returnLink.attributes('href'), 'http://test').searchParams)).toEqual(changed)
    wrapper.unmount()
  })
})
