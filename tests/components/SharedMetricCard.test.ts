import { fireEvent, render, screen, within } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import Metric from '~/components/ui/Metric.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import StatCard from '~/components/ui/StatCard.vue'

const NuxtLink = defineComponent({
  props: ['to'],
  setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()),
})

describe('共享指标卡保留原接口行为', () => {
  it('网格保留真实零、未知来源与负数穿透，不以缺口重算已有金额', async () => {
    const view = render(Metric, {
      props: { label: '工资实际净额', value: 0, money: true, to: '/subcontract/payroll/payments', status: '部分已知', cutoff: '2026-10', missingSources: '原成员分配缺失' },
      global: { components: { NuxtLink } },
    })
    const group = screen.getByRole('group', { name: '工资实际净额' })
    expect(within(group).getByText('¥0.00')).not.toBeNull()
    expect(within(group).queryByRole('link')).toBeNull()
    expect(within(group).getByText('原成员分配缺失')).not.toBeNull()
    await view.rerender({ value: -500 })
    expect(within(group).getByRole('link', { name: '¥-500.00' }).getAttribute('href')).toBe('/subcontract/payroll/payments')
    await view.rerender({ value: '尚不能确认', money: false })
    expect(within(group).queryByRole('link')).toBeNull()
    expect(within(group).getByText('尚不能确认')).not.toBeNull()
    expect(within(group).getByText('部分已知')).not.toBeNull()
  })

  it('独立卡片保留点击筛选、无前缀金额与单位，且不会提交所在表单', async () => {
    const onClick = vi.fn()
    render(StatCard, { props: { label: '工资已付', value: 1234.5, money: true, suffix: '元', clickable: true, onClick } })
    const action = screen.getByRole('button', { name: '工资已付 1,234.50元' })
    expect(action.getAttribute('type')).toBe('button')
    await fireEvent.click(action)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('公式复用可访问的就近说明，分区标题与原扩展内容都保留', async () => {
    render(Metric, { props: { label: '工资成本', value: '历史未记录', formula: '原实发加真实补退，不重复计成员分配。' } })
    await fireEvent.click(screen.getByRole('button', { name: '查看工资成本说明' }))
    expect(screen.getByText('原实发加真实补退，不重复计成员分配。')).not.toBeNull()
    render(SectionHeader, { props: { title: '工资来源' }, slots: { extra: '<button type="button">重新核对</button>' } })
    expect(screen.getByRole('heading', { name: '工资来源', level: 2 })).not.toBeNull()
    expect(screen.getByRole('button', { name: '重新核对' })).not.toBeNull()
  })
})
