import type { MonthlyStatementView } from '~/lib/boq/monthly'
import type { BoqWorkspace } from '~/lib/boq/read-model'
import { fireEvent, render, screen } from '@testing-library/vue'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import BoqMonthlyWorkspace from '~/components/boq/BoqMonthlyWorkspace.vue'

const statement: MonthlyStatementView = {
  id: 'statement-1',
  projectId: 'project-1',
  contractId: 'contract-1',
  month: '2026-07',
  status: 'draft',
  totalAmount: 123456789.12,
  note: '',
  lines: [{
    id: 'statement-line-1',
    boqLineId: 'boq-line-1',
    itemName: '超长分项名称',
    unit: 'm²',
    autoQty: 100,
    adjustedQty: null,
    effectiveQty: 100,
    unitPrice: 1234567.8912,
    amount: 123456789.12,
    note: '',
    sortOrder: 10,
  }],
}

const workspace: BoqWorkspace = {
  projectId: 'project-1',
  projectName: '合和新城',
  contractId: 'contract-1',
  contractNo: 'RJ-HHXC-SG-2026-0000000000000000001',
  contractName: '施工合同',
  files: [],
  lines: [],
  catalog: [],
  changes: [],
  monthlyStatements: [{
    id: statement.id,
    month: statement.month,
    status: statement.status,
    totalAmount: statement.totalAmount,
    note: '',
  }],
  summary: {
    lineCount: 0,
    baseAmount: 0,
    approvedChangeAmount: 0,
    effectiveAmount: 0,
  },
}

const KitTableStub = defineComponent({
  props: {
    data: { type: Array, required: true },
  },
  setup(props, { slots }) {
    return () => h('div', (props.data as MonthlyStatementView['lines']).map(row =>
      h('div', { key: row.id }, slots.action?.({ row })),
    ))
  },
})

const global = {
  components: {
    KitTable: KitTableStub,
    NuxtLink: defineComponent({
      props: { to: { type: [String, Object], required: true } },
      setup(props, { slots }) {
        return () => h('a', {
          href: typeof props.to === 'string' ? props.to : (props.to as { path: string }).path,
        }, slots.default?.())
      },
    }),
  },
}

describe('boqMonthlyWorkspace', () => {
  beforeAll(() => {
    vi.stubGlobal('useKitUI', () => ({ formModal: vi.fn() }))
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('提供甲方报量单入口且草稿允许调整', async () => {
    const view = render(BoqMonthlyWorkspace, {
      props: { workspace, statement },
      global,
    })

    expect(screen.getByRole('link', { name: '打开甲方报量单' }).getAttribute('href'))
      .toBe('/owner/report/statement-1')
    expect(screen.getByText('¥123,456,789.12')).not.toBeNull()
    expect((screen.getByRole('button', { name: '调整' }) as HTMLButtonElement).disabled).toBe(false)
    await fireEvent.click(screen.getByRole('button', { name: '导出本月' }))
    expect(view.emitted().export).toEqual([[statement]])
  })

  it.each([
    ['adjusted', '已申报'],
    ['exported', '已审定'],
  ] as const)('%s 状态显示为%s且禁止从清单工作台调整', (status, label) => {
    render(BoqMonthlyWorkspace, {
      props: {
        workspace: {
          ...workspace,
          monthlyStatements: [{ ...workspace.monthlyStatements[0]!, status }],
        },
        statement: { ...statement, status },
      },
      global,
    })

    expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    expect((screen.getByRole('button', { name: '调整' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
