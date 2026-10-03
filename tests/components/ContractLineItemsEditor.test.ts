import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import ContractLineItemsEditor from '~/components/contract/ContractLineItemsEditor.vue'
import KitEditGrid from '~/components/ui/KitEditGrid.vue'

const KitButton = defineComponent({
  inheritAttrs: false,
  emits: ['click'],
  template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
})

const KitTable = defineComponent({
  props: {
    data: { type: Array, default: () => [] },
    columns: { type: Array, default: () => [] },
  },
  setup(props, { slots }) {
    return () => h('table', (props.data as Record<string, unknown>[]).map(row =>
      h('tr', { key: String(row.__kitRowKey) }, (props.columns as { slot: string }[]).map(column =>
        h('td', slots[column.slot]?.({ row })))),
    ))
  },
})

function mountEditor(lines: Array<Record<string, unknown>> = []) {
  return mount(ContractLineItemsEditor, {
    props: { lines },
    global: {
      components: { KitButton, KitEditGrid, KitTable },
      stubs: { LookupSelect: true },
    },
  })
}

describe('contractLineItemsEditor', () => {
  it('adds a domain-default row without mutating the incoming prop', async () => {
    const source = [{
      id: 'line-1',
      materialName: '瓷砖',
      unit: '㎡',
      qty: 2,
      taxInclusiveUnitPrice: 30,
    }]
    const wrapper = mountEditor(source)

    expect(source).toHaveLength(1)

    await wrapper.get('[data-testid="add-contract-line"]').trigger('click')
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual([
      source[0],
      expect.objectContaining({
        materialName: '',
        unit: '',
        qty: 1,
        taxInclusiveUnitPrice: 0,
      }),
    ])
  })

  it('configures the shared edit grid with derived amount and forwards controlled updates', async () => {
    const wrapper = mountEditor([{
      materialName: '砂浆',
      unit: '包',
      qty: 1,
      taxInclusiveUnitPrice: 10,
    }])

    const grid = wrapper.findComponent(KitEditGrid)
    const amountColumn = (grid.props('columns') as Array<{
      key: string
      derive?: (row: Record<string, unknown>) => unknown
    }>).find(column => column.key === 'amount')
    expect(amountColumn?.derive?.({
      materialName: '砂浆',
      qty: 3,
      taxInclusiveUnitPrice: 12.5,
    })).toBe(37.5)

    const updated = [{
      materialName: '砂浆',
      unit: '包',
      qty: 3,
      taxInclusiveUnitPrice: 12.5,
    }]
    grid.vm.$emit('update:modelValue', updated)
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual(updated)
  })

  it('imports Excel TSV rows in editable-column order', async () => {
    const wrapper = mountEditor()
    await wrapper.get('[data-testid="import-contract-lines"]').trigger('click')
    await wrapper.get('[data-testid="contract-lines-tsv"]').setValue(
      '瓷砖\t600×600\t品牌A\t㎡\t10\t23.8\t2026-08-01\t首批',
    )
    await wrapper.get('[data-testid="confirm-contract-lines-import"]').trigger('click')

    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual([{
      materialName: '瓷砖',
      spec: '600×600',
      brand: '品牌A',
      unit: '㎡',
      qty: 10,
      taxInclusiveUnitPrice: 23.8,
      plannedArrivalDate: '2026-08-01',
      note: '首批',
    }])
  })

  it('pastes one Excel column into the existing corresponding rows', async () => {
    const source = [
      { id: 'line-1', materialName: '方管 A', unit: '米', qty: 1, taxInclusiveUnitPrice: 20 },
      { id: 'line-2', materialName: '方管 B', unit: '米', qty: 2, taxInclusiveUnitPrice: 30 },
    ]
    const wrapper = mountEditor(source)
    await wrapper.get('[aria-label="数量，第 1 行"]').trigger('paste', {
      clipboardData: { getData: () => '100\r\n80\r\n' },
    })

    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual([
      { ...source[0], qty: 100 },
      { ...source[1], qty: 80 },
    ])
    expect(source[0]?.qty).toBe(1)
    expect(source[1]?.qty).toBe(2)
  })

  it('rejects an entire column paste when a numeric cell is invalid', async () => {
    const source = [
      { id: 'line-1', materialName: '方管 A', qty: 1 },
      { id: 'line-2', materialName: '方管 B', qty: 2 },
    ]
    const wrapper = mountEditor(source)
    await wrapper.get('[aria-label="数量，第 1 行"]').trigger('paste', {
      clipboardData: { getData: () => '100\n不是数字' },
    })

    expect(wrapper.emitted('update')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain('第 2 行数量')
    expect(source.map(line => line.qty)).toEqual([1, 2])
  })

  it('keeps a non-first starting row and blank cells aligned across successive column pastes', async () => {
    const source = [
      { id: 'line-1', materialName: '保留首行', qty: 10, spec: '原规格 A' },
      { id: 'line-2', materialName: '方管 B', qty: 20, spec: '原规格 B' },
      { id: 'line-3', materialName: '方管 C', qty: 30, spec: '原规格 C' },
    ]
    const wrapper = mountEditor(source)
    await wrapper.get('[aria-label="数量，第 2 行"]').trigger('paste', {
      clipboardData: { getData: () => '80\n\n60\n' },
    })
    const withQuantities = [
      source[0],
      { ...source[1], qty: 80 },
      { ...source[2], qty: null },
      { qty: 60 },
    ]
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual(withQuantities)

    await wrapper.setProps({ lines: withQuantities })
    await wrapper.get('[aria-label="规格型号，第 2 行"]').trigger('paste', {
      clipboardData: { getData: () => '40×40\n\n50×50\n' },
    })
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual([
      source[0],
      { ...withQuantities[1], spec: '40×40' },
      { ...withQuantities[2], spec: '' },
      { qty: 60, spec: '50×50' },
    ])
  })

  it('allows arbitrary units and keeps a missing imported unit empty', async () => {
    const wrapper = mountEditor([{ materialName: '方管', unit: '' }])
    await wrapper.get('[aria-label="单位，第 1 行"]').setValue('根（6米/根）')
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual([{ materialName: '方管', unit: '根（6米/根）' }])

    await wrapper.get('[data-testid="import-contract-lines"]').trigger('click')
    await wrapper.get('[data-testid="contract-lines-tsv"]').setValue('方管 B\t50×50\t品牌 B\t\t2\t30\t\t')
    await wrapper.get('[data-testid="confirm-contract-lines-import"]').trigger('click')
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual([
      { materialName: '方管', unit: '' },
      { materialName: '方管 B', spec: '50×50', brand: '品牌 B', unit: '', qty: 2, taxInclusiveUnitPrice: 30, plannedArrivalDate: '', note: '' },
    ])
  })

  it('rejects a multi-column clipboard block without changing the grid', async () => {
    const wrapper = mountEditor([{ materialName: '方管', unit: '米' }])
    await wrapper.get('[aria-label="物资名称，第 1 行"]').trigger('paste', {
      clipboardData: { getData: () => '方管 B\t50×50\n方管 C\t60×60' },
    })
    expect(wrapper.emitted('update')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain('单列')
  })

  it.each([
    { qty: '80', price: '不是数字', field: '含税单价' },
    { qty: 'NaN', price: '20', field: '数量' },
    { qty: 'Infinity', price: '20', field: '数量' },
    { qty: '0x20', price: '20', field: '数量' },
    { qty: '80', price: 'NaN', field: '含税单价' },
  ])('rejects TSV $field=$qty/$price before appending any imported lines', async ({ qty, price, field }) => {
    const wrapper = mountEditor([{ id: 'existing', materialName: '原材料' }])
    await wrapper.get('[data-testid="import-contract-lines"]').trigger('click')
    await wrapper.get('[data-testid="contract-lines-tsv"]').setValue(
      `方管 A\t40×40\t品牌 A\t米\t100\t20\t\t\n方管 B\t50×50\t品牌 B\t米\t${qty}\t${price}\t\t`,
    )
    await wrapper.get('[data-testid="confirm-contract-lines-import"]').trigger('click')
    expect(wrapper.emitted('update')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain(`第 2 行${field}`)
    expect(wrapper.find('[data-testid="contract-lines-tsv"]').exists()).toBe(true)
  })

  it('preserves leading empty TSV fields and supports the date column paste', async () => {
    const wrapper = mountEditor()
    await wrapper.get('[data-testid="import-contract-lines"]').trigger('click')
    await wrapper.get('[data-testid="contract-lines-tsv"]').setValue('\t40×40\t\t米\t100\t20\t2026-10-02\t')
    await wrapper.get('[data-testid="confirm-contract-lines-import"]').trigger('click')
    const imported = [{ materialName: '', spec: '40×40', brand: '', unit: '米', qty: 100, taxInclusiveUnitPrice: 20, plannedArrivalDate: '2026-10-02', note: '' }]
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual(imported)

    await wrapper.setProps({ lines: imported })
    await wrapper.get('[aria-label="计划到货日期，第 1 行"]').trigger('paste', {
      clipboardData: { getData: () => '2026-10-03\n2026-10-04\n' },
    })
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual([
      { ...imported[0], plannedArrivalDate: '2026-10-03' },
      { plannedArrivalDate: '2026-10-04' },
    ])
  })

  it('keeps quoted multiline Excel notes in their source rows and decodes escaped quotes', async () => {
    const source = [
      { id: 'line-1', materialName: '方管 A', note: '原备注 A' },
      { id: 'line-2', materialName: '方管 B', note: '原备注 B' },
    ]
    const wrapper = mountEditor(source)
    await wrapper.get('[aria-label="备注，第 1 行"]').trigger('paste', {
      clipboardData: { getData: () => '"首批\n次批"\r\n"注明""优先"""\r\n' },
    })
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual([
      { ...source[0], note: '首批\n次批' },
      { ...source[1], note: '注明"优先"' },
    ])
  })

  it('keeps a tab inside a quoted Excel cell within the selected column', async () => {
    const wrapper = mountEditor([{ materialName: '方管 A' }, { materialName: '方管 B' }])
    await wrapper.get('[aria-label="备注，第 1 行"]').trigger('paste', {
      clipboardData: { getData: () => '"型号\t参数"\r\n下一批\r\n' },
    })
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual([
      { materialName: '方管 A', note: '型号\t参数' },
      { materialName: '方管 B', note: '下一批' },
    ])
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('preserves empty source records around quoted cells without adding a terminator row', async () => {
    const source = [1, 2, 3, 4].map(index => ({ id: `line-${index}`, materialName: `方管 ${index}`, note: '原备注' }))
    const wrapper = mountEditor(source)
    await wrapper.get('[aria-label="备注，第 1 行"]').trigger('paste', {
      clipboardData: { getData: () => '\r\n"首批\n次批"\r\n""\r\n\r\n' },
    })
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual([
      { ...source[0], note: '' },
      { ...source[1], note: '首批\n次批' },
      { ...source[2], note: '' },
      { ...source[3], note: '' },
    ])
  })

  it('decodes quoted cells in the compatible eight-column append import', async () => {
    const wrapper = mountEditor()
    await wrapper.get('[data-testid="import-contract-lines"]').trigger('click')
    await wrapper.get('[data-testid="contract-lines-tsv"]').setValue(
      '"方管""A"""\t40×40\t品牌 A\t米\t"100"\t"20"\t2026-10-03\t"首批\n次批\t参数"\r\n方管 B\t50×50\t品牌 B\t根\t80\t30\t\t下一批\r\n',
    )
    await wrapper.get('[data-testid="confirm-contract-lines-import"]').trigger('click')
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual([
      { materialName: '方管"A"', spec: '40×40', brand: '品牌 A', unit: '米', qty: 100, taxInclusiveUnitPrice: 20, plannedArrivalDate: '2026-10-03', note: '首批\n次批\t参数' },
      { materialName: '方管 B', spec: '50×50', brand: '品牌 B', unit: '根', qty: 80, taxInclusiveUnitPrice: 30, plannedArrivalDate: '', note: '下一批' },
    ])
  })

  it.each(['首批\n"未闭合', '首批\n"已闭合"多余字符'])('rejects malformed quoted clipboard cells atomically: %s', async (text) => {
    const wrapper = mountEditor([{ materialName: '方管 A', note: '原备注' }])
    await wrapper.get('[aria-label="备注，第 1 行"]').trigger('paste', {
      clipboardData: { getData: () => text },
    })
    expect(wrapper.emitted('update')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain('本次未应用')
  })
})
