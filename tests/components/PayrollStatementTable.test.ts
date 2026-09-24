import type { WageStatement } from '~/lib/payroll/statements'
import { render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import PayrollStatementTable from '~/components/payroll/PayrollStatementTable.vue'

describe('工资单列表刷新', () => {
  it('已有记录或空快照不遮表，初载保留加载提示且请求期间禁选旧单据', async () => {
    const { rerender } = render(PayrollStatementTable, {
      props: { statements: [{ id: 'old', leaderName: '张师傅' }] as WageStatement[], selectedId: '', loading: true, hasSnapshot: true },
      global: { components: {
        SectionHeader: true,
        NuxtLink: defineComponent({ template: '<a><slot /></a>' }),
        KitTable: defineComponent({
          props: ['loading', 'data'],
          setup: (props, { slots }) => () => h('div', props.loading ? '正在加载工资单' : props.data.length ? props.data.map((row: WageStatement) => h('div', [row.leaderName, slots.action?.({ row })])) : '当前范围暂无工资单'),
        }),
      } },
    })
    expect(screen.getByText('张师傅')).not.toBeNull()
    expect(screen.getByRole('button', { name: '查看' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText('正在加载工资单')).toBeNull()
    await rerender({ statements: [], hasSnapshot: true })
    expect(screen.getByText('当前范围暂无工资单')).not.toBeNull()
    await rerender({ hasSnapshot: false })
    expect(screen.getByText('正在加载工资单')).not.toBeNull()
  })
})
