import type { BoqLineView } from '~/lib/boq/read-model'
import { render, screen } from '@testing-library/vue'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h } from 'vue'
import BoqLinesTable from '~/components/boq/BoqLinesTable.vue'

const line: BoqLineView = {
  id: 'line-1',
  boqFileId: 'file-1',
  changeOrderId: null,
  itemId: 'item-1',
  section: '装饰',
  trade: '泥水工',
  itemName: '墙砖铺贴',
  unit: '㎡',
  baseQty: 26,
  baseUnitPrice: 80,
  baseAmount: 2080,
  effectiveQty: 28,
  effectiveUnitPrice: 80,
  effectiveAmount: 2240,
  approvedChangeAmount: 160,
  traceKey: '清单.xlsx·户内·3',
  sourceSheet: '户内',
  sourceRow: 3,
  recognizedQty: 26,
  recognizedUnitPrice: 80,
  manuallyCorrected: false,
  building: '1栋',
  unitType: 'A',
  multiplier: 1,
  room: '客餐厅',
  floorZone: '',
  spec: '',
  taxRate: null,
  ownerSupplied: false,
  sortOrder: 1,
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
      const first = (props.data as BoqLineView[])[0]
      return h('div', {
        'data-testid': 'boq-table-contract',
        'data-action-width': action?.width,
        'data-action-resizable': String((action as { resizable?: boolean })?.resizable),
      }, first ? slots.action?.({ row: first, rowIndex: 0 }) : [])
    }
  },
})

describe('boqLinesTable', () => {
  beforeAll(() => {
    vi.stubGlobal('computed', computed)
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the fixed action column compact and exposes every action by name', () => {
    render(BoqLinesTable, {
      props: {
        lines: [line],
        catalog: [],
      },
      global: {
        components: {
          KitTable: KitTableStub,
        },
      },
    })

    const contract = screen.getByTestId('boq-table-contract')
    expect(Number(contract.dataset.actionWidth)).toBeLessThanOrEqual(160)
    expect(contract.dataset.actionResizable).toBe('false')
    expect(screen.getByRole('button', { name: /编辑清单行/ })).not.toBeNull()
    expect(screen.getByRole('button', { name: /现场算式/ })).not.toBeNull()
    expect(screen.getByRole('button', { name: /楼层计划/ })).not.toBeNull()
    expect(screen.getByRole('button', { name: /删除清单行/ })).not.toBeNull()
  })
})
