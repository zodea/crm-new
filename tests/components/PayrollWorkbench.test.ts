import { fireEvent, render, screen, within } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import PayrollFilters from '~/components/payroll/PayrollFilters.vue'
import PayrollStatementDetail from '~/components/payroll/PayrollStatementDetail.vue'

const options = {
  projects: [{ id: 'project-a', name: '项目甲', code: 'PA' }],
  crews: [{ id: 'crew-a', name: '泥水班' }],
  workers: [{ id: 'worker-a', name: '张师傅', crewId: 'crew-a' }],
  c2SubjectConfigs: [{
    id: 'config-c2',
    projectId: 'project-a',
    crewId: 'crew-a',
    leaderWorkerId: 'worker-a',
    unitRate: 360,
    ruleText: '证明人确认后生效。',
    updatedAt: '2026-07-29',
  }],
}

const NuxtLinkStub = defineComponent({
  setup(_, { slots }) {
    return () => h('a', slots.default?.())
  },
})

describe('payroll workbench components', () => {
  it('draft creator exposes only provisional/field quantity and final locks field', async () => {
    const { emitted } = render(PayrollFilters, {
      props: {
        options,
        filters: { projectId: 'project-a', month: '2026-07', status: '', crewId: 'crew-a' },
      },
      global: { components: { NuxtLink: NuxtLinkStub } },
    })

    await fireEvent.click(screen.getByRole('button', { name: '生成月度草稿' }))
    const source = screen.getByRole<HTMLSelectElement>('combobox', { name: '工资取数口径' })
    expect(within(source).queryByRole('option', { name: /合同量/ })).toBeNull()
    expect(within(source).getByRole('option', { name: '暂估量' })).not.toBeNull()
    expect(within(source).getByRole('option', { name: '现场复核量' })).not.toBeNull()
    const format = screen.getByRole<HTMLSelectElement>('combobox', { name: '工资格式族' })
    expect(within(format).getByRole<HTMLOptionElement>('option', { name: /B · 合同清单直报/ }).disabled).toBe(true)
    expect(within(format).getByRole<HTMLOptionElement>('option', { name: /C2 · 零星签工/ }).disabled).toBe(false)
    await fireEvent.update(format, 'C1')
    const period = screen.getByRole<HTMLSelectElement>('combobox', { name: '工资期间档' })
    expect(within(period).getByRole<HTMLOptionElement>('option', { name: '结算 95%' }).disabled).toBe(true)
    expect(within(period).getByRole<HTMLOptionElement>('option', { name: '尾款 100%' }).disabled).toBe(true)

    await fireEvent.update(screen.getByRole('combobox', { name: '单据用途' }), 'final')
    expect(source.value).toBe('field')
    expect(source.disabled).toBe(true)

    await fireEvent.click(screen.getByRole('button', { name: '确认生成草稿' }))
    expect(emitted().create?.[0]?.[0]).toMatchObject({
      projectId: 'project-a',
      crewId: 'crew-a',
      leaderWorkerId: 'worker-a',
      purpose: 'final',
      quantitySource: 'field',
    })
  })

  it('c2 uses the persisted subject config and locks signed work at 100%', async () => {
    const { emitted } = render(PayrollFilters, {
      props: {
        options,
        filters: { projectId: 'project-a', month: '2026-07', status: '', crewId: 'crew-a' },
      },
      global: { components: { NuxtLink: NuxtLinkStub } },
    })
    await fireEvent.click(screen.getByRole('button', { name: '生成月度草稿' }))
    await fireEvent.update(screen.getByRole('combobox', { name: '工资格式族' }), 'C2')

    expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: 'C2 大工单价' }).value).toBe('360')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'C2 签工确认规则' }).value)
      .toBe('证明人确认后生效。')
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '工资取数口径' }).value).toBe('field')
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '工资取数口径' }).disabled).toBe(true)

    await fireEvent.click(screen.getByRole('button', { name: '确认生成草稿' }))
    expect(emitted().create?.[0]?.[0]).toMatchObject({
      formatFamily: 'C2',
      quantitySource: 'field',
      payRatio: 1,
      c2Rate: 360,
      dayworkRuleText: '证明人确认后生效。',
    })
  })

  it('released detail is read-only and explains the frozen field snapshot', () => {
    render(PayrollStatementDetail, {
      props: {
        statement: {
          id: 'statement-a',
          projectId: 'project-a',
          projectName: '项目甲',
          crewId: 'crew-a',
          crewName: '泥水班',
          leaderWorkerId: 'worker-a',
          leaderName: '张师傅',
          subjectConfigId: null,
          month: '2026-07',
          purpose: 'final',
          periodKind: 'settlement',
          formatFamily: 'A',
          quantitySource: 'field',
          status: 'released',
          needsRecheck: false,
          payRatio: 1,
          cumulativeAmount: 1840,
          previouslyPaid: 0,
          grossAmount: 1840,
          actualAmount: 1800,
          sourceVersion: 'field-v1',
          sourceUpdatedAt: '2026-07-28',
          checkedSourceVersion: 'field-v1',
          adjustmentReason: '',
          operatorName: '项目经理',
          submittedAt: '2026-07-29',
          checkedAt: '2026-07-28',
          releasedAt: '2026-07-29',
          note: '',
          members: [{
            workerId: 'worker-a',
            workerName: '张师傅',
            isLeader: true,
          }],
          memberWorkerIds: ['worker-a'],
          allocationRecorded: true,
          allocations: [{
            workerId: 'worker-a',
            workerName: '张师傅',
            isLeader: true,
            allocatedAmountFen: 180000,
            amount: 1800,
          }],
          lines: [{
            id: 'line-a',
            workerId: 'worker-a',
            itemId: 'item-a',
            itemName: '墙砖铺贴',
            unit: '㎡',
            quantity: 92,
            unitPrice: 20,
            amount: 1840,
          }],
          dayworkRecords: [],
        },
      },
    })

    expect(screen.getByText(/现场复核量快照/)).not.toBeNull()
    expect(screen.getByText(/后续改量改价不追溯/)).not.toBeNull()
    expect(screen.queryByRole('button', { name: '核对并锁定现场量' })).toBeNull()
    expect(screen.queryByRole('spinbutton', { name: '墙砖铺贴工资单价' })).toBeNull()
  })

  it('validates the release total and persists a complete member split', async () => {
    const { emitted } = render(PayrollStatementDetail, {
      props: {
        statement: {
          id: 'statement-zero',
          projectId: 'project-a',
          projectName: '项目甲',
          crewId: 'crew-a',
          crewName: '泥水班',
          leaderWorkerId: 'worker-a',
          leaderName: '张师傅',
          subjectConfigId: null,
          month: '2026-07',
          purpose: 'advance',
          periodKind: 'monthly',
          formatFamily: 'A',
          quantitySource: 'field',
          status: 'checked',
          needsRecheck: false,
          payRatio: 0.8,
          cumulativeAmount: 1600,
          previouslyPaid: 1500,
          grossAmount: 100,
          actualAmount: null,
          sourceVersion: 'field-v1',
          sourceUpdatedAt: '2026-07-28',
          checkedSourceVersion: 'field-v1',
          adjustmentReason: '',
          operatorName: '',
          submittedAt: null,
          checkedAt: '2026-07-28',
          releasedAt: null,
          note: '',
          members: [
            {
              workerId: 'worker-a',
              workerName: '张师傅',
              isLeader: true,
            },
            {
              workerId: 'worker-b',
              workerName: '李师傅',
              isLeader: false,
            },
          ],
          memberWorkerIds: ['worker-a', 'worker-b'],
          allocationRecorded: false,
          allocations: [],
          lines: [],
          dayworkRecords: [],
        },
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: '填写发放分配' }))
    const release = screen.getByRole<HTMLButtonElement>('button', { name: '确认已发放' })
    expect(release.disabled).toBe(false)
    expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: '张师傅分配金额' }).value).toBe('100')
    expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: '李师傅分配金额' }).value).toBe('0')

    await fireEvent.update(screen.getByRole('spinbutton', { name: '实际发放总额' }), '0.004')
    expect(release.disabled).toBe(true)
    await fireEvent.update(screen.getByRole('spinbutton', { name: '实际发放总额' }), '100.01')
    expect(release.disabled).toBe(true)

    await fireEvent.update(screen.getByRole('spinbutton', { name: '实际发放总额' }), '100')
    await fireEvent.update(screen.getByRole('spinbutton', { name: '张师傅分配金额' }), '60')
    expect(release.disabled).toBe(true)
    await fireEvent.update(screen.getByRole('spinbutton', { name: '李师傅分配金额' }), '40')
    expect(release.disabled).toBe(false)
    await fireEvent.click(release)

    expect(emitted().release?.[0]).toEqual([
      100,
      [
        { workerId: 'worker-a', amount: 60 },
        { workerId: 'worker-b', amount: 40 },
      ],
    ])
  })
})
