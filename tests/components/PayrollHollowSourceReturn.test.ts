import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import PayrollASourceReturn from '~/components/payroll/PayrollASourceReturn.vue'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { createPayrollCHollowFixture } from '../helpers/payroll-c-hollow-fixture'

afterEach(() => vi.unstubAllGlobals())
for (const format of ['C1', 'C2'] as const) {
  it(`${format}由已授权空鼓原户返回同一工资，只有原户ID及撤权不得放行`, async () => {
    const f = await createPayrollCHollowFixture(format)
    let wrapper: ReturnType<typeof mount> | null = null
    try {
      setActivePinia(createPinia())
      let statementId: string
      if (format === 'C1') {
        const initial = await f.service.c1Form({ origin: 'real' }, { statementId: null, draftKey: 'return-c1', draft: f.draft })
        statementId = (await f.service.executeC1(f.c1Command(initial, { kind: 'save-c1-draft', draft: f.draft }))).statementId!
      }
      else {
        const initial = await f.service.c2Form({ origin: 'real' }, { statementId: null, draftKey: 'return-c2', draft: f.draft })
        statementId = (await f.service.executeC2(f.c2Command(initial, { kind: 'save-c2-draft', draft: f.draft }))).statementId!
      }
      const read = format === 'C1' ? await f.service.c1Form({ origin: 'real' }, { statementId }) : await f.service.c2Form({ origin: 'real' }, { statementId })
      const source = read.hollow!.rows[0]!.source!
      const back = `/subcontract/payroll/${statementId}?origin=real`
      const resolved = resolveNavigationTarget(source, { returnTo: back })
      if (resolved.state !== 'resolved')
        throw new Error('原服务未授权空鼓入口')
      const url = new URL(resolved.to, 'https://test.invalid')
      vi.stubGlobal('useRoute', () => ({ path: url.pathname, query: Object.fromEntries(url.searchParams) }))
      vi.stubGlobal('usePayrollStore', () => ({}))
      vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: f.service } }))
      const page = () => mount(PayrollASourceReturn, { props: { kind: 'quantity-unit', sourceId: f.scope.unitId, projectId: f.scope.projectId, origin: 'real' }, global: { components: { NuxtLink: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }) } } })
      wrapper = page()
      await vi.waitFor(() => expect(wrapper!.find('a').exists()).toBe(true))
      expect(wrapper.get('a').attributes('href')).toBe(back)
      wrapper.unmount()
      f.setSession({ ...f.session(), capabilities: f.session().capabilities.filter(capability => capability !== 'quantity:read') })
      wrapper = page()
      await vi.waitFor(() => expect(wrapper!.find('[role="alert"]').exists()).toBe(true))
      expect(wrapper.find('a').exists()).toBe(false)
      expect(wrapper.text()).toContain('授权关系尚未获证明')
    }
    finally {
      wrapper?.unmount()
      await f.close()
    }
  }, 30_000)
}
