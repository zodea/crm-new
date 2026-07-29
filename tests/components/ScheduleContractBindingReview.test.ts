import type { ScheduleContractBindingPreview } from '~/lib/schedule/contract-binding'
import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import ScheduleContractBindingReview from '~/components/schedule/ScheduleContractBindingReview.vue'

const KitTableStub = defineComponent({
  props: {
    data: {
      type: Array,
      required: true,
    },
  },
  setup(props) {
    return () => h(
      'div',
      { 'data-testid': 'binding-difference-table' },
      (props.data as ScheduleContractBindingPreview['items']).map(item =>
        h('div', { key: item.id }, [
          item.name,
          item.mapped ? '已映射' : '未映射',
          String(item.provisionalQty),
          String(item.contractQty),
          String(item.differenceQty),
        ]),
      ),
    )
  },
})

const NuxtLinkStub = defineComponent({
  props: {
    to: {
      type: [String, Object],
      required: true,
    },
  },
  setup(_, { slots }) {
    return () => h('a', { href: '#' }, slots.default?.())
  },
})

function preview(canBind: boolean): ScheduleContractBindingPreview {
  return {
    groupId: 'group-1',
    groupName: '前期1-2栋',
    projectId: 'project-1',
    contractId: 'contract-1',
    contractNo: 'SG-001',
    contractName: '施工总承包合同',
    buildings: [
      { id: 'building-1', code: '1', name: '1栋', covered: true, contractLineCount: 2 },
      { id: 'building-2', code: '2', name: '2栋', covered: canBind, contractLineCount: canBind ? 1 : 0 },
    ],
    extraContractBuildings: [
      { id: 'building-3', code: '3', name: '3栋', covered: true, contractLineCount: 1 },
    ],
    items: [{
      id: 'item-1',
      code: 'wall',
      name: '墙砖粘贴',
      unit: 'm²',
      mapped: canBind,
      provisionalQty: 48,
      contractQty: canBind ? 66 : 0,
      differenceQty: canBind ? 18 : -48,
    }],
    blockers: canBind ? [] : ['合同清单未明确覆盖楼栋：2栋'],
    warnings: ['合同还包含分组外楼栋：3栋'],
    canBind,
  }
}

const global = {
  components: {
    KitTable: KitTableStub,
    NuxtLink: NuxtLinkStub,
  },
}

describe('scheduleContractBindingReview', () => {
  it('只读呈现楼栋覆盖、额外范围、分项数量差异与阻断原因', () => {
    render(ScheduleContractBindingReview, {
      props: { preview: preview(false) },
      global,
    })

    expect(screen.getByRole('heading', { name: '绑定差异复核' })).not.toBeNull()
    expect(screen.getByText('施工总承包合同 · SG-001')).not.toBeNull()
    expect(screen.getByText('合同清单未明确覆盖楼栋：2栋')).not.toBeNull()
    expect(screen.getByText('合同还包含分组外楼栋：3栋')).not.toBeNull()
    expect(screen.getByText('1栋')).not.toBeNull()
    expect(screen.getByText('2栋')).not.toBeNull()
    expect(screen.getByTestId('binding-difference-table').textContent)
      .toContain('墙砖粘贴未映射480-48')
    expect((screen.getByRole('button', { name: '确认绑定合同' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('link', { name: '补齐合同清单证据' })).not.toBeNull()
    expect(screen.getByRole('link', { name: '返回调整或拆分分组' })).not.toBeNull()
  })

  it('仅在无阻断时发出绑定事件', async () => {
    const view = render(ScheduleContractBindingReview, {
      props: { preview: preview(true) },
      global,
    })

    await fireEvent.click(screen.getByRole('button', { name: '确认绑定合同' }))

    expect(view.emitted().bind).toEqual([[]])
  })

  it('提交中保留原按钮文案并禁用，避免宽度跳动', async () => {
    const view = render(ScheduleContractBindingReview, {
      props: { preview: preview(true), busy: false },
      global,
    })

    await view.rerender({ preview: preview(true), busy: true })

    const button = screen.getByRole('button', { name: '确认绑定合同' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(button.textContent).toContain('确认绑定合同')
    expect(button.textContent).not.toContain('正在绑定')
  })
})
