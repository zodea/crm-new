import type { QuantityCompletionWorkspace } from '~/lib/quantity/completion'
import { render, screen, within } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, nextTick, reactive, shallowRef, watch } from 'vue'
import QuantityUnitDetailScreen from '~/components/quantity/QuantityUnitDetailScreen.vue'

vi.mock('~/lib/db/client', () => ({ db: {} }))

function workspace(): QuantityCompletionWorkspace {
  return {
    projectId: 'project-quantity',
    matrixArchivedAt: null,
    planWindow: null,
    unit: { id: 'unit-quantity', code: '101', name: '101户', floorId: 'floor', floorName: '1层', buildingId: 'building', buildingName: '1栋', templateId: 'template' },
    stages: [{
      id: 'stage-first',
      code: 'FIRST',
      name: '第一阶段',
      trade: '泥水工',
      sortOrder: 1,
      currentAssignment: null,
      completion: null,
      photos: [],
      warnings: [],
      quantities: [
        { roomId: 'room-a', roomName: '客厅', itemId: 'item-a', itemName: '墙面', unit: '㎡', recognizedContractQty: null, contractQty: 0, provisionalQty: 10, fieldQty: null },
        { roomId: 'room-b', roomName: '卧室', itemId: 'item-a', itemName: '墙面', unit: '㎡', recognizedContractQty: null, contractQty: 0, provisionalQty: 20, fieldQty: 5 },
      ],
    }],
  }
}

beforeEach(() => {
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useTabTitle', vi.fn())
  vi.stubGlobal('useKitUI', () => ({ error: vi.fn() }))
})

function openDetail(value = workspace()) {
  const store = reactive({ completionWorkspace: value, completionLoading: false, completionError: '', loadCompletion: vi.fn().mockResolvedValue(undefined) })
  vi.stubGlobal('useQuantityStore', () => store)
  render(QuantityUnitDetailScreen, {
    props: { projectId: 'project-quantity', unitId: 'unit-quantity' },
    global: {
      stubs: {
        ContextHelp: true,
        QuantityCompletionDialog: true,
        Dialog: true,
        DialogContent: true,
        DialogTitle: true,
        NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot /></a>' }),
      },
    },
  })
  return store
}

describe('户详情工程量合计', () => {
  it('阶段和全户的部分缺量都明确显示缺项，不能把已知部分当完整总量', () => {
    openDetail()
    const table = screen.getByRole('table', { name: '第一阶段量明细' })
    const subtotal = within(table).getByRole('row', { name: /分项小计/ })
    expect(subtotal.textContent).toContain('缺 1 项')
    expect(screen.getByRole('region', { name: '全户合计' }).textContent).toContain('缺 1 项')
  })

  it('全户按单位区分共享分项去重，重读明确零后撤下缺量提示', async () => {
    const value = workspace()
    const original = value.stages[0]!
    value.stages = [
      original,
      { ...original, id: 'stage-second', name: '第二阶段' },
      { ...original, id: 'stage-length', name: '长度阶段', quantities: [{ ...original.quantities[0]!, itemId: 'item-length', itemName: '收边', unit: 'm', contractQty: 2, provisionalQty: 3, fieldQty: 7 }] },
    ]
    const store = openDetail(value)
    const footer = screen.getByRole('region', { name: '全户合计' })
    const area = within(footer).getByRole('group', { name: '㎡全户合计' })
    const length = within(footer).getByRole('group', { name: 'm全户合计' })
    expect(area.textContent).toMatch(/合同量\s*0/)
    expect(area.textContent).toMatch(/暂估量\s*30/)
    expect(area.textContent).toContain('缺 1 项')
    expect(length.textContent).toMatch(/现场量\s*7/)

    const refreshed = workspace()
    refreshed.stages[0]!.quantities = refreshed.stages[0]!.quantities.map(line => ({ ...line, fieldQty: 0 }))
    store.completionWorkspace = refreshed
    await nextTick()
    expect(footer.textContent).toMatch(/现场量\s*0/)
    expect(footer.textContent).not.toMatch(/缺 \d+ 项/)
  })
})
