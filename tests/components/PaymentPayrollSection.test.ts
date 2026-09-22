import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import PaymentPayrollSection from '~/components/finance/payment-management/PaymentPayrollSection.vue'
import { payrollAdjustmentFormRead } from '../helpers/payroll-adjustment-ui-fixture'

it('工资项目选择进入专用地址参数，冷返回及同路径切换恢复且不改付款申请筛选', async () => {
  const route = reactive({ path: '/finance/payment-management', query: { project: 'request-project' } as Record<string, string>, fullPath: '/finance/payment-management?project=request-project' })
  const replace = vi.fn(async (target: { path: string, query: Record<string, string> }) => {
    route.query = target.query
    route.fullPath = `${target.path}?${new URLSearchParams(target.query)}`
  })
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ replace }))
  vi.stubGlobal('usePayrollStore', () => ({ loadRead: vi.fn().mockResolvedValue({ context: payrollAdjustmentFormRead().context, projects: [{ id: 'wage-project', name: '工资项目', code: 'W' }] }) }))
  const options = { global: { stubs: { SectionHeader: true, NuxtLink: { template: '<a><slot /></a>' }, LookupSelect: { props: ['modelValue'], emits: ['update:modelValue'], template: '<input aria-label="选择工资项目" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">' }, PayrollActualLedgerSection: { props: ['projectId', 'returnTo'], template: '<p data-testid="wage-ledger">{{ projectId }} / {{ returnTo }}</p>' } } } }
  const first = render(PaymentPayrollSection, options)
  await fireEvent.update(screen.getByLabelText('选择工资项目'), 'wage-project')
  await flushPromises()
  expect(replace).toHaveBeenCalledWith({ path: route.path, query: { project: 'request-project', payrollProject: 'wage-project' } })
  expect(screen.getByTestId('wage-ledger').textContent).toContain('payrollProject=wage-project')
  first.unmount()
  const cold = render(PaymentPayrollSection, options)
  await flushPromises()
  expect((screen.getByLabelText('选择工资项目') as HTMLInputElement).value).toBe('wage-project')
  route.query = { ...route.query, payrollProject: 'next-wage-project' }
  await flushPromises()
  expect(screen.getByTestId('wage-ledger').textContent).toContain('next-wage-project')
  expect(route.query.project).toBe('request-project')
  cold.unmount()
})
