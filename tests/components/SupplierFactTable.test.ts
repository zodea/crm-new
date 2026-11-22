import type { SupplierContractDTO, SupplierSettlementDTO } from '~/lib/supplier/repository'
import { render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import SupplierFactTable from '~/pages/base/supplier/_components/SupplierFactTable.vue'
import SupplierRelationLink from '~/pages/base/supplier/_components/SupplierRelationLink.vue'

describe('分供方合同事实类别', () => {
  it('当前Other实际结算进入现有原单；无来源的旧目标保持不可点击', () => {
    const settlement: SupplierSettlementDTO['settlement'] = { state: 'resolved', entity: 'settlement', id: 'actual-other', label: '实际其他支出结算', no: 'SET-01' }
    const row: SupplierSettlementDTO = { settlement, navigation: { kind: 'entity-detail', subject: settlement, variant: 'other_settlement', view: null, filters: { dataOrigin: 'real' } }, project: { state: 'unavailable', entity: 'project', id: null, label: null, reason: 'source-unavailable' }, projectNavigation: { kind: 'unavailable', reason: 'not-connected' }, contract: { state: 'missing', entity: 'contract', id: null, label: null, reason: 'not-recorded' }, contractNavigation: { kind: 'unavailable', reason: 'missing-id' }, settlementType: '费用结算', totalAmount: '0.00', settlementDate: null, status: 'confirmed' }
    const unconnected = { ...row, settlement: { ...settlement, id: 'old-unknown', label: '旧未接结算' }, navigation: { kind: 'unavailable' as const, reason: 'missing-route' as const } }
    render(SupplierFactTable, { props: { tab: 'settlements', projects: [], contracts: [], settlements: [row, unconnected], invoices: [], payments: [] }, global: { components: { SupplierRelationLink, NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot /></a>' }), KitTable: defineComponent({ props: ['columns', 'data'], template: '<table><tbody><tr v-for="record in data" :key="record.settlement.id"><td v-for="column in columns" :key="column.field || column.title"><slot v-if="column.slot" :name="column.slot" :row="record" /><template v-else>{{ record[column.field] }}</template></td></tr></tbody></table>' }) } } })
    expect(screen.getByRole('link', { name: '实际其他支出结算' }).getAttribute('href')).toBe('/contract/other-settlement/actual-other?origin=real')
    expect(screen.queryByRole('link', { name: '旧未接结算' })).toBeNull()
    expect(screen.getByText('旧未接结算')).not.toBeNull()
  })

  it('显示中文类别，同时保留原始合同类型与专属详情目标', () => {
    const contract: SupplierContractDTO['contract'] = { state: 'resolved', entity: 'contract', id: 'other-contract', label: '检测服务合同', no: 'QT-001' }
    const row: SupplierContractDTO = {
      contract,
      kind: 'other_expense',
      navigation: { kind: 'entity-detail', subject: contract, variant: 'other_expense', view: null, filters: { dataOrigin: 'real', contractKind: 'other_expense' } },
      project: { state: 'missing', entity: 'project', id: null, label: null, reason: 'not-recorded' },
      projectNavigation: { kind: 'unavailable', reason: 'missing-id' },
      effectiveAmount: '35.00',
      signDate: null,
      status: '生效',
      isDraft: false,
    }
    render(SupplierFactTable, {
      props: { tab: 'contracts', projects: [], contracts: [row], settlements: [], invoices: [], payments: [] },
      global: { components: {
        SupplierRelationLink,
        NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot /></a>' }),
        KitTable: defineComponent({
          props: ['columns', 'data'],
          template: '<table><tbody><tr v-for="record in data" :key="record.contract.id"><td v-for="column in columns" :key="column.field || column.title"><slot v-if="column.slot" :name="column.slot" :row="record" /><template v-else>{{ record[column.field] }}</template></td></tr></tbody></table>',
        }),
      } },
    })
    expect(screen.getByText('其他支出合同')).not.toBeNull()
    expect(screen.queryByText('other_expense')).toBeNull()
    expect(screen.getByRole('link', { name: '检测服务合同' }).getAttribute('href')).toBe('/contract/other-expense/other-contract?origin=real')
    expect(row.kind).toBe('other_expense')
    expect(row.navigation).toMatchObject({ variant: 'other_expense', filters: { dataOrigin: 'real', contractKind: 'other_expense' } })
  })
})
