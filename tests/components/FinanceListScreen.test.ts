import { render, screen } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, onActivated, onMounted, readonly, shallowRef, watch } from 'vue'
import FinanceListScreen from '~/components/finance/FinanceListScreen.vue'

const navigateTo = vi.fn()
const listRows = shallowRef({
  receipt: [{
    id: 'receipt-local-1',
    no: 'SK-001',
    name: '正式本地客户',
    projectName: '示例项目',
    partyName: '示例合同',
    amount: 100,
    date: '2026-08-23',
    status: 'submitted',
    customerId: 'customer-local-1',
    dataOrigin: null,
  }],
})
const financeStore = {
  listRows: readonly(listRows),
  loading: readonly(shallowRef(false)),
  loadList: vi.fn().mockResolvedValue(undefined),
}

const KitTableStub = defineComponent({
  props: ['data'],
  setup(props, { slots }) {
    return () => h('div', props.data.map((row: unknown) => [
      slots.name?.({ row }),
      slots.action?.({ row }),
    ]))
  },
})

beforeEach(() => {
  navigateTo.mockReset()
  financeStore.loadList.mockClear()
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('onMounted', onMounted)
  vi.stubGlobal('onActivated', onActivated)
  vi.stubGlobal('navigateTo', navigateTo)
  vi.stubGlobal('useFinanceStore', () => financeStore)
  vi.stubGlobal('storeToRefs', () => ({ listRows, loading: shallowRef(false) }))
})

describe('收款列表来源边界', () => {
  it('没有中央来源时名称是普通文本，编辑仍为独立动作', async () => {
    render(FinanceListScreen, {
      props: { kind: 'receipt' },
      global: {
        components: {
          KitTable: KitTableStub,
          KitButton: defineComponent({ template: '<button><slot /></button>' }),
          ListFilterBar: defineComponent({ template: '<div />' }),
        },
      },
    })

    expect(screen.getByTestId('non-central-receipt-name').textContent).toContain('正式本地客户')
    expect(screen.queryByRole('button', { name: '正式本地客户' })).toBeNull()
    expect(screen.getByTitle('编辑')).toBeTruthy()
  })
})
