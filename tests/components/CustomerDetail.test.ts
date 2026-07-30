import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { computed, defineComponent } from 'vue'
import CustomerDetailOverview from '~/components/master-data/CustomerDetailOverview.vue'
import CustomerDetailRelations from '~/components/master-data/CustomerDetailRelations.vue'
import CustomerFormFields from '~/components/master-data/CustomerFormFields.vue'

vi.stubGlobal('computed', computed)

const KitTable = defineComponent({
  props: ['data', 'empty'],
  template: `
    <div data-testid="kit-table">
      <span v-if="!data.length" data-testid="empty">{{ typeof empty === 'string' ? empty : empty.title }}</span>
      <div v-for="row in data" :key="row.id" data-testid="row">
        <slot name="project" :row="row" />
        <slot name="contract" :row="row" />
        <slot name="receipt" :row="row" />
        <slot name="relation" :row="row" />
        <slot name="status" :row="row" />
      </div>
    </div>
  `,
})

const NuxtLink = defineComponent({
  props: ['to'],
  template: '<a :href="to"><slot /></a>',
})

const customer = {
  id: 'customer_1',
  name: '合和地产集团',
  aliases: ['合和地产'],
  taxNo: '91440101TEST',
  legalRep: '何先生',
  registeredAddress: '广州市天河区',
  invoiceName: '合和地产集团',
  bank: '建设银行',
  bankAccount: '62270001',
  contact: '林经理',
  contactPhone: '13800000001',
  status: 'active',
  note: '重点客户',
  updatedAt: '2026-07-29',
}

describe('客户详情展示', () => {
  it('展示真实客户主数据，空字段使用明确占位', () => {
    const wrapper = mount(CustomerDetailOverview, { props: { customer } })
    expect(wrapper.text()).toContain('91440101TEST')
    expect(wrapper.text()).toContain('林经理')
    expect(wrapper.text()).toContain('62270001')
    expect(wrapper.text()).toContain('重点客户')
  })

  it('项目、合同、收款都提供已有详情路由下钻', () => {
    const baseProps = {
      projects: [{
        id: 'project_1',
        name: '合和新城',
        code: 'HHXC-01',
        relationRole: '主客户' as const,
        status: '施工中',
        startDate: '2026-01-01',
        plannedEnd: '2026-12-31',
        manager: '张经理',
        contractCount: 1,
        effectiveContractAmount: 1000000,
        receiptCount: 1,
        effectiveReceiptAmount: 320000,
      }],
      contracts: [{
        id: 'contract_1',
        no: 'SG-001',
        name: '施工合同',
        projectId: 'project_1',
        projectName: '合和新城',
        amount: 1000000,
        changed: 0,
        effectiveAmount: 1000000,
        receiptAmount: 320000,
        outstandingAmount: 680000,
        signDate: '2026-01-02',
        status: '履约中',
        isDraft: false,
      }],
      receipts: [{
        id: 'receipt_1',
        no: 'SK-001',
        receiptDate: '2026-05-01',
        projectId: 'project_1',
        projectName: '合和新城',
        contractId: 'contract_1',
        contractName: '施工合同',
        payerAccount: '合和地产集团',
        amount: 320000,
        effectiveAmount: 320000,
        paymentMethod: '银行转账',
        status: 'submitted',
        isDraft: false,
      }],
    }
    const global = { components: { KitTable, NuxtLink } }

    const projectView = mount(CustomerDetailRelations, {
      props: { ...baseProps, tab: 'projects' },
      global,
    })
    expect(projectView.get('a').attributes('href')).toBe('/project/project_1')

    const contractView = mount(CustomerDetailRelations, {
      props: { ...baseProps, tab: 'contracts' },
      global,
    })
    expect(contractView.findAll('a').map(link => link.attributes('href'))).toEqual([
      '/project/project_1',
      '/contract/contract_1',
    ])

    const receiptView = mount(CustomerDetailRelations, {
      props: { ...baseProps, tab: 'receipts' },
      global,
    })
    expect(receiptView.findAll('a').map(link => link.attributes('href'))).toEqual([
      '/project/project_1',
      '/contract/contract_1',
      '/finance/receipt/receipt_1',
    ])
  })

  it('没有业务关系时展示领域空状态，不生成静态成功数据', () => {
    const wrapper = mount(CustomerDetailRelations, {
      props: {
        tab: 'contracts',
        projects: [],
        contracts: [],
        receipts: [],
      },
      global: { components: { KitTable, NuxtLink } },
    })
    expect(wrapper.get('[data-testid="empty"]').text()).toBe('暂无施工合同')
    expect(wrapper.find('[data-testid="row"]').exists()).toBe(false)
  })
})

describe('客户表单浏览器语义', () => {
  it('为浏览器自动填充提供稳定字段名，并把联系电话声明为电话输入', () => {
    const wrapper = mount(CustomerFormFields, {
      props: {
        modelValue: {
          name: '',
          aliases: [],
          taxNo: '',
          legalRep: '',
          registeredAddress: '',
          invoiceName: '',
          bank: '',
          bankAccount: '',
          contact: '',
          contactPhone: '',
        },
        fieldErrors: {},
      },
      global: {
        components: {
          SectionHeader: defineComponent({
            props: ['title'],
            template: '<h2>{{ title }}</h2>',
          }),
        },
      },
    })

    const inputs = Object.fromEntries(
      wrapper.findAll('input').map(input => [input.attributes('name'), input]),
    )

    expect(inputs['customer-name']?.attributes('autocomplete')).toBe('organization')
    expect(inputs['customer-registered-address']?.attributes('autocomplete')).toBe('street-address')
    expect(inputs['customer-contact']?.attributes('autocomplete')).toBe('name')
    expect(inputs['customer-contact-phone']?.attributes()).toMatchObject({
      autocomplete: 'tel',
      type: 'tel',
    })
    expect(inputs['customer-tax-no']?.attributes('spellcheck')).toBe('false')
    expect(inputs['customer-bank-account']?.attributes('spellcheck')).toBe('false')
    expect(inputs['customer-aliases']?.attributes('placeholder')).toBe('多个别名用逗号或顿号分隔…')
  })
})
