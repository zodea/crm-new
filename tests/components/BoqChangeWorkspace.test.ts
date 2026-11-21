import type { BoqChangeOrderView, BoqWorkspace } from '~/lib/boq/read-model'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, shallowRef } from 'vue'
import RowActionMenu from '~/components/ui/RowActionMenu.vue'
import BoqChangeWorkspace from '~/pages/contract/boq/_components/BoqChangeWorkspace.vue'

vi.mock('@vueuse/core', async importOriginal => ({
  ...await importOriginal<typeof import('@vueuse/core')>(),
  useFileDialog: () => ({
    onChange: vi.fn(),
    open: vi.fn(),
  }),
}))

function change(status: BoqChangeOrderView['status']): BoqChangeOrderView {
  return {
    id: `change-${status}`,
    code: `BG-${status}`,
    name: `${status} 变更`,
    changeType: 'qty',
    status,
    statusNote: '',
    directiveNo: '',
    directiveType: '',
    totalAmount: 100,
    approvedAt: status === 'approved' ? '2026-07-29' : null,
    ledgerId: status === 'approved' ? 'ledger-approved' : null,
    attachmentCount: 0,
    attachments: [],
    lines: [],
    createdAt: '2026-07-29',
  }
}

const workspace: BoqWorkspace = {
  projectId: 'project-1',
  projectName: '合和新城',
  contractId: 'contract-1',
  contractNo: 'SG-001',
  contractName: '施工合同',
  files: [],
  lines: [],
  catalog: [],
  changes: [
    change('draft'),
    change('submitted'),
    change('rejected'),
    change('approved'),
  ],
  monthlyStatements: [],
  summary: {
    lineCount: 0,
    baseAmount: 0,
    approvedChangeAmount: 0,
    effectiveAmount: 0,
  },
}

const KitTableStub = defineComponent({
  props: {
    columns: {
      type: Array,
      required: true,
    },
    data: {
      type: Array,
      required: true,
    },
  },
  setup(props, { slots }) {
    return () => {
      const action = (props.columns as { type?: string, width?: number }[])
        .find(column => column.type === 'action')
      return h('div', {
        'data-testid': 'boq-change-table-contract',
        'data-action-width': action?.width,
      }, (props.data as BoqChangeOrderView[]).map((row, rowIndex) =>
        h('div', { key: row.id }, [
          slots.code?.({ row, rowIndex }),
          slots.action?.({ row, rowIndex }),
        ]),
      ))
    }
  },
})

const global = {
  components: {
    KitTable: KitTableStub,
    RowActionMenu,
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

describe('boqChangeWorkspace', () => {
  beforeAll(() => {
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('shallowRef', shallowRef)
    vi.stubGlobal('useKitUI', () => ({
      formModal: vi.fn(),
      warning: vi.fn(),
    }))
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('以紧凑固定入口承载四档状态动作，不再常驻堆叠文字按钮', async () => {
    const view = render(BoqChangeWorkspace, {
      props: { workspace },
      global,
    })

    expect(Number(screen.getByTestId('boq-change-table-contract').dataset.actionWidth)).toBeLessThanOrEqual(56)
    expect(screen.queryByRole('button', { name: '上报' })).toBeNull()
    expect(screen.queryByRole('button', { name: '删除' })).toBeNull()

    const draftTrigger = screen.getByRole('button', { name: 'BG-draft变更单操作' })
    await fireEvent.click(draftTrigger)
    const draftMenu = screen.getByRole('menu', { name: 'BG-draft变更单操作' })
    expect(within(draftMenu).getByRole('menuitem', { name: '上报' })).not.toBeNull()
    expect(within(draftMenu).getByRole('menuitem', { name: '登记附件' })).not.toBeNull()
    expect(within(draftMenu).getByRole('menuitem', { name: '删除' })).not.toBeNull()
    await fireEvent.click(within(draftMenu).getByRole('menuitem', { name: '上报' }))

    expect(view.emitted().transition).toEqual([[
      {
        orderId: 'change-draft',
        target: 'submitted',
        note: '已提交甲方',
      },
    ]])

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'BG-submitted变更单操作' })).not.toBeNull(),
    )
    await fireEvent.click(screen.getByRole('button', { name: 'BG-submitted变更单操作' }))
    const submittedMenu = screen.getByRole('menu', { name: 'BG-submitted变更单操作' })
    expect(within(submittedMenu).getByRole('menuitem', { name: '签证' })).not.toBeNull()
    expect(within(submittedMenu).getByRole('menuitem', { name: '退回' })).not.toBeNull()

    await fireEvent.keyDown(submittedMenu, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'BG-rejected变更单操作' })).not.toBeNull(),
    )
    await fireEvent.click(screen.getByRole('button', { name: 'BG-rejected变更单操作' }))
    expect(within(screen.getByRole('menu', { name: 'BG-rejected变更单操作' }))
      .getByRole('menuitem', { name: '重新上报' })).not.toBeNull()

    await fireEvent.keyDown(screen.getByRole('menu', { name: 'BG-rejected变更单操作' }), { key: 'Escape' })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'BG-approved变更单操作' })).not.toBeNull(),
    )
    await fireEvent.click(screen.getByRole('button', { name: 'BG-approved变更单操作' }))
    expect(within(screen.getByRole('menu', { name: 'BG-approved变更单操作' }))
      .getByRole('menuitem', { name: '更正' })).not.toBeNull()
  })

  it('已签证变更编号按真实来源单进入业主变更单，未签证编号不造死链', () => {
    render(BoqChangeWorkspace, {
      props: { workspace },
      global,
    })

    expect(screen.queryByRole('link', { name: 'BG-draft' })).toBeNull()
    expect(screen.getByRole('link', { name: 'BG-approved' }).getAttribute('href'))
      .toBe('/owner/change/change-approved')
  })
})
