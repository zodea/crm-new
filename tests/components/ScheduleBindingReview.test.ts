import type { ScheduleBindingPreview } from '~/lib/schedule/central-binding-contract'
import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import ScheduleBindingReview from '~/components/schedule/ScheduleBindingReview.vue'

const Table = defineComponent({ props: ['data', 'columns', 'rowKey'], setup(props, { slots }) {
  return () => h('table', (props.data ?? []).map((row: Record<string, unknown>) => h('tr', { 'key': String(row[props.rowKey]), 'data-testid': 'quantity-row' }, props.columns.map((column: { field: string, slot?: string }) => h('td', slots[column.slot ?? '']?.({ row }) ?? String(row[column.field]))))))
} })
const complete = (value: number) => ({ value, knownValue: value, sourceCount: 1, missingCount: 0, unitMissing: false, completeness: 'complete' as const })
const preview: ScheduleBindingPreview = {
  projectId: 'p',
  groupId: 'g',
  groupName: '原暂估楼栋组',
  contractId: 'c',
  contractName: '施工合同',
  contractNo: 'C1',
  buildings: [{ id: 'b', code: 'B', name: '一栋', covered: true, contractLineCount: 2 }],
  extraContractBuildings: [{ id: 'extra', code: 'B2', name: '额外二栋', covered: true, contractLineCount: 1 }],
  blockers: [],
  warnings: [],
  canBind: true,
  items: [
    { id: 'same-item', code: 'I', name: '同一分项', unit: '㎡', mapped: true, provisional: { value: null, knownValue: 8, sourceCount: 2, missingCount: 1, unitMissing: false, completeness: 'partial' }, contract: complete(12), differenceQty: null, reasons: ['有一户暂估量未提供'], floorPlanIds: ['floor1'], contractLineIds: ['line1'] },
    { id: 'same-item', code: 'I', name: '同一分项', unit: 'm', mapped: true, provisional: complete(0), contract: complete(0), differenceQty: 0, reasons: [], floorPlanIds: ['floor2'], contractLineIds: ['line2'] },
    { id: 'unknown', code: 'U', name: '单位缺失', unit: '', mapped: true, provisional: { value: null, knownValue: null, sourceCount: 1, missingCount: 0, unitMissing: true, completeness: 'partial' }, contract: complete(1), differenceQty: null, reasons: ['单位未提供，无法比较'], floorPlanIds: ['floor3'], contractLineIds: [] },
  ],
}
function open(extra: { readonly?: boolean, bound?: boolean } = {}) {
  return render(ScheduleBindingReview, { props: { preview, sourceVersion: 'fixed', ...extra }, global: { stubs: { KitTable: Table } } })
}
describe('冻结差异展示', () => {
  it('同分项四条稳定来源与长原因均提供可聚焦阅读区，第四条仍发出原行身份', async () => {
    const many = { ...preview, items: [{ ...preview.items[0]!, contractLineIds: ['line1', 'line2', 'line3', 'line4'], reasons: ['逐户原件缺量说明。'.repeat(30)] }] }
    const view = render(ScheduleBindingReview, { props: { preview: many, sourceVersion: 'fixed', bound: true }, global: { stubs: { KitTable: Table } } })
    expect(screen.getByRole('region', { name: '同一分项 ㎡ 共4条清单来源' }).getAttribute('tabindex')).toBe('0')
    expect(screen.getByRole('region', { name: '同一分项 ㎡ 完整来源说明' }).getAttribute('tabindex')).toBe('0')
    await fireEvent.click(screen.getByRole('button', { name: '查看清单来源 4', exact: true }))
    expect(view.emitted().repair).toEqual([['line4']])
  })
  it('8/null明确缺项、真零保零、同分项不同单位分别成行，数量缺失不会新增禁止绑定门槛', async () => {
    const view = open()
    const rows = screen.getAllByTestId('quantity-row')
    expect(rows).toHaveLength(3)
    expect(rows[0]!.textContent).toContain('已知 8 · 缺 1 项')
    expect(rows[0]!.textContent).toContain('不可确定')
    expect(rows[1]!.textContent).not.toContain('不可确定')
    expect(rows[1]!.textContent).toContain('0')
    expect(rows[2]!.textContent).toContain('未知 · 单位未提供')
    expect(screen.getByText(/额外二栋/).textContent).toContain('不会自动纳入')
    const submit = screen.getByRole('button', { name: '确认绑定合同' }) as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    await fireEvent.click(submit)
    expect(view.emitted().bind).toHaveLength(1)
  })
  it('绑定后差异只读但可查看稳定清单来源', async () => {
    const view = open({ readonly: true, bound: true })
    expect(screen.queryByRole('button', { name: '确认绑定合同' })).toBeNull()
    await fireEvent.click(screen.getAllByRole('button', { name: '查看清单来源 1' })[0]!)
    expect(view.emitted().repair).toEqual([['line1']])
  })
})
