import type { EntityRefDTO, NavigationIntentDTO } from '~/types/read-model'
import { cleanup, render, screen } from '@testing-library/vue'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import CustomerRelationLink from '~/components/master-data/CustomerRelationLink.vue'
import ReceiptReferenceLink from '~/components/receipt/ReceiptReferenceLink.vue'
import SupplierRelationLink from '~/components/supplier/SupplierRelationLink.vue'

const global = { components: { NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot /></a>' }) } }
afterEach(cleanup)

describe.each([
  ['客户关联', CustomerRelationLink],
  ['分供方关联', SupplierRelationLink],
  ['收款关联', ReceiptReferenceLink],
] as const)('%s展示公共引用状态', (_label, component) => {
  it.each([
    ['forbidden', 'permission-denied', '无权限'],
    ['unavailable', 'source-unavailable', '来源暂不可用'],
  ] as const)('%s不显示链接、身份或缓存名称，恢复后重新显示真实目标', async (state, reason, text) => {
    const reference: EntityRefDTO = { state, entity: 'customer', id: null, label: null, reason } as EntityRefDTO
    const oldNavigation: NavigationIntentDTO = { kind: 'entity-detail', subject: { state: 'resolved', entity: 'customer', id: 'restricted-customer', label: '旧缓存敏感名称', no: null }, variant: 'detail', view: null, filters: { dataOrigin: 'real' } }
    const propsFor = (ref: EntityRefDTO, navigation: NavigationIntentDTO) => component === ReceiptReferenceLink ? { reference: ref, origin: 'real' as const } : { reference: ref, navigation }
    const view = render(component, { props: propsFor(reference, oldNavigation), global })
    expect(screen.getByText(text)).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    expect(view.container.innerHTML).not.toContain('restricted-customer')
    expect(view.container.innerHTML).not.toContain('旧缓存敏感名称')
    const visible: EntityRefDTO = { state: 'resolved', entity: 'customer', id: 'visible-customer', label: '重新可读客户', no: null }
    await view.rerender(propsFor(visible, { ...oldNavigation, subject: visible }))
    expect(screen.getByRole('link', { name: '重新可读客户' }).getAttribute('href')).toBe('/base/customer/visible-customer?origin=real')
  })
})
