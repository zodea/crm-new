import { render, screen, waitFor, within } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h } from 'vue'
import ProjectMetrics from '~/components/project/ProjectMetrics.vue'
import Metric from '~/components/ui/Metric.vue'
import MetricGrid from '~/components/ui/MetricGrid.vue'
import MoneyLink from '~/components/ui/MoneyLink.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'

const NuxtLinkStub = defineComponent({
  props: {
    to: {
      type: [String, Object],
      required: true,
    },
  },
  setup(props, { slots }) {
    return () => h('a', {
      href: typeof props.to === 'string' ? props.to : JSON.stringify(props.to),
    }, slots.default?.())
  },
})

vi.stubGlobal('useProjectDetailStore', () => ({
  operationSummaries: {
    'project-1': {
      mainContractAmount: 100,
      supplementAmount: 0,
      ownerChangeAmount: 20,
      changedContractAmount: 120,
      projectReceipt: 70,
      paymentAmount: 30,
      currentReceipt: 15,
      currentPayment: 5,
      managementFee: 0,
      availableBalance: 50,
    },
  },
  invoiceSummaries: {
    'project-1': {
      outputAmount: 60,
      outputTax: 6,
      inputAmount: 25,
      inputTax: 2.5,
      vat: 3.5,
      taxBurdenRate: 0.058333,
      archivedCount: 2,
    },
  },
  load: vi.fn().mockResolvedValue(undefined),
}))
vi.stubGlobal('useInvoiceStore', () => ({
  load: vi.fn().mockResolvedValue(undefined),
}))
vi.stubGlobal('computed', computed)

describe('项目详情真实聚合摘要', () => {
  it('依次展示经营数据、往来款、票据信息，并只让非零金额进入真实目标', async () => {
    render(ProjectMetrics, {
      props: { projectId: 'project-1' },
      global: {
        components: {
          Metric,
          MetricGrid,
          MoneyLink,
          NuxtLink: NuxtLinkStub,
          SectionHeader,
        },
      },
    })

    expect(screen.getAllByRole('region').map(region => region.getAttribute('aria-label'))).toEqual([
      '项目经营数据',
      '往来款',
      '票据信息',
    ])

    const supplement = screen.getByRole('group', { name: '增补合同额' })
    expect(within(supplement).queryByRole('link')).toBeNull()
    expect(supplement.textContent).toContain('¥0.00')

    expect(screen.getByRole('group', { name: '往来收款' }).querySelector('a')?.getAttribute('href'))
      .toBe('{"path":"/project/project-1","query":{"tab":"current"}}')
    expect(screen.getByRole('group', { name: '进项票额' }).querySelector('a')?.getAttribute('href'))
      .toBe('{"path":"/finance/ledger","query":{"project":"project-1"}}')
    expect(screen.getByRole('group', { name: '管理费' }).textContent).toContain('—')
    await waitFor(() => {
      expect(screen.getByLabelText('指标完整性').textContent).toContain('状态：已加载')
    })
    expect(screen.getByLabelText('指标完整性').textContent).toContain('各金额卡分别标注')
    expect(within(screen.getByRole('group', { name: '主合同金额' })).getByText('当前数据库快照')).not.toBeNull()
    expect(within(screen.getByRole('group', { name: '主合同金额' })).getByText('无已知缺口')).not.toBeNull()
    expect(within(screen.getByRole('group', { name: '管理费' })).getByText('管理费配置')).not.toBeNull()
  })

  it('汇总源没有返回当前项目时展示未知状态，不把缺失事实格式化为零', async () => {
    vi.stubGlobal('useProjectDetailStore', () => ({
      operationSummaries: {},
      invoiceSummaries: {},
      load: vi.fn().mockResolvedValue(undefined),
    }))

    render(ProjectMetrics, {
      props: { projectId: 'missing-project' },
      global: {
        components: {
          Metric,
          MetricGrid,
          MoneyLink,
          NuxtLink: NuxtLinkStub,
          SectionHeader,
        },
      },
    })

    await waitFor(() => {
      expect(screen.queryByRole('group', { name: '主合同金额' })).toBeNull()
    })
    expect(screen.queryByText('¥0.00')).toBeNull()
  })
})
