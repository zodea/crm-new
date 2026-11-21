import type { PaymentApplicationDetail } from '~/lib/finance/payment-detail'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import PaymentPayrollSection from '~/components/finance/payment-management/PaymentPayrollSection.vue'
import PaymentApplicationInsightPanel from '~/components/finance/PaymentApplicationInsightPanel.vue'
import { payrollAdjustmentFormRead } from '../helpers/payroll-adjustment-ui-fixture'

describe('付款申请洞察说明', () => {
  it('保留业务风险与状态，口径说明按需展开且独立于标题', async () => {
    render(PaymentApplicationInsightPanel, {
      props: {
        detail: {
          supplierId: null,
          insight: { checks: [{ key: 'over-limit', level: 'danger', title: '申请金额超限', summary: '本次申请超过可付余额', detail: '请先核对付款申请与合同金额。' }] },
        } as unknown as PaymentApplicationDetail,
        statusText: '待审核',
        statusClass: 'text-warn',
      },
    })
    expect(screen.getByRole('heading', { name: '智能业务洞察', exact: true })).not.toBeNull()
    expect(screen.getByText('待审核')).not.toBeNull()
    expect(screen.getByText('本次申请超过可付余额')).not.toBeNull()
    expect(screen.queryByText(/根据当前付款申请及关联单据/)).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '查看业务洞察说明' }))
    expect(screen.getByText('根据当前付款申请及关联单据计算金额与风险提示。')).not.toBeNull()
    expect(screen.queryByText(/前端|补造/)).toBeNull()
  })
})

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
