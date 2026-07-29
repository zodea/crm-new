import type { WageStatement } from '~/lib/payroll/statements'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import PayrollStatementLinesTable from '~/components/payroll/PayrollStatementLinesTable.vue'
import PayrollStatementMembersTable from '~/components/payroll/PayrollStatementMembersTable.vue'
import PayrollStatementTable from '~/components/payroll/PayrollStatementTable.vue'

const KitTable = defineComponent({
  props: ['data', 'empty'],
  template: `
    <div data-testid="kit-table">
      <div v-for="row in data" :key="row.id" data-testid="row">
        <span>{{ row.workerName }}</span>
        <span>{{ row.itemName }}</span>
        <span>{{ row.amount }}</span>
        <slot name="quantity" :row="row" />
        <slot name="action" :row="row" />
      </div>
    </div>
  `,
})

const SectionHeader = defineComponent({
  props: ['title', 'subtitle'],
  template: '<header>{{ title }} {{ subtitle }}</header>',
})

const NuxtLink = defineComponent({
  props: ['to'],
  template: '<a :href="to"><slot /></a>',
})

function statement(status: WageStatement['status'] = 'released'): WageStatement {
  return {
    id: 'statement-a',
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
    quantitySource: status === 'draft' ? 'provisional' : 'field',
    status,
    needsRecheck: false,
    payRatio: 0.8,
    cumulativeAmount: 1600,
    previouslyPaid: 0,
    grossAmount: 1600,
    actualAmount: status === 'released' ? 1500 : null,
    sourceVersion: 'field-v1',
    sourceUpdatedAt: '2026-07-28',
    checkedSourceVersion: status === 'draft' ? '' : 'field-v1',
    adjustmentReason: '',
    operatorName: '项目经理',
    submittedAt: status === 'released' ? '2026-07-29' : null,
    checkedAt: status === 'draft' ? null : '2026-07-28',
    releasedAt: status === 'released' ? '2026-07-29' : null,
    note: '',
    members: [{ workerId: 'worker-a', workerName: '张师傅', isLeader: true }],
    memberWorkerIds: ['worker-a'],
    allocationRecorded: status === 'released',
    allocations: status === 'released'
      ? [{
          workerId: 'worker-a',
          workerName: '张师傅',
          isLeader: true,
          allocatedAmountFen: 150000,
          amount: 1500,
        }]
      : [],
    lines: [{
      id: 'line-a',
      workerId: 'worker-a',
      itemName: '墙砖铺贴',
      unit: '㎡',
      quantity: 100,
      unitPrice: 20,
      amount: 2000,
    }],
    dayworkRecords: [],
  }
}

const tableGlobal = { components: { KitTable, SectionHeader } }

describe('payroll statement dedicated detail tables', () => {
  it('renders frozen allocation only for a released statement', () => {
    const released = mount(PayrollStatementMembersTable, {
      props: { statement: statement('released') },
      global: tableGlobal,
    })
    expect(released.text()).toContain('张师傅')
    expect(released.text()).toContain('1500')

    const draft = mount(PayrollStatementMembersTable, {
      props: { statement: statement('draft') },
      global: tableGlobal,
    })
    expect(draft.text()).not.toContain('1500')
    expect(draft.text()).toContain('尚未发放')
  })

  it('maps real worker names and preserves quantity units in the line table', () => {
    const wrapper = mount(PayrollStatementLinesTable, {
      props: { statement: statement() },
      global: tableGlobal,
    })
    expect(wrapper.text()).toContain('张师傅')
    expect(wrapper.text()).toContain('墙砖铺贴')
    expect(wrapper.text()).toContain('100 ㎡')
  })

  it('keeps the inline preview and exposes a separate read-only detail route', () => {
    const wrapper = mount(PayrollStatementTable, {
      props: {
        statements: [statement()],
        selectedId: '',
      },
      global: { components: { KitTable, SectionHeader, NuxtLink } },
    })
    expect(wrapper.get('button').text()).toBe('查看')
    expect(wrapper.get('a').attributes('href')).toBe('/subcontract/payroll/statement-a')
  })
})
