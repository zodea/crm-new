import type { ContractPriceFact } from '~/lib/material-contract/price-facts'
import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import ContractPriceTable from '~/pages/material/_components/ContractPriceTable.vue'

it('真实约定价表在五档视口保未知税点/真零、依据门禁、原价、源链接和键盘局部滚动', async () => {
  const base: ContractPriceFact = { dataOrigin: 'real', contractId: 'price-a', lineId: 'line-a', parentContractId: null, contractName: '原吨合同', contractNo: 'A01', supplierId: 'supplier-a', supplierName: '供方甲', projectId: 'project-a', projectName: '原项目', date: '2026-10-04', materialName: '方管', spec: '40×40×2', materialGrade: '304', unit: '吨', quantity: 1, taxInclusiveUnitPrice: 18000, applicableTaxRate: null }
  const rows = [base, { ...base, contractId: 'price-b', lineId: 'line-b', contractName: '真实零合同', unit: '千克', quantity: 1000, taxInclusiveUnitPrice: 0, applicableTaxRate: 0, materialGrade: '' }]
  await render(defineComponent({ setup: () => () => h('main', { style: { padding: '12px', maxWidth: '100%', minWidth: '0' } }, h(ContractPriceTable, { rows })) }), {
    global: { components: { NuxtLink: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }) } },
  })
  const table = page.getByRole('region', { name: '合同约定单价' })
  await expect.element(table).toHaveTextContent('税费或运费条件未核实')
  const tax = document.querySelectorAll('[data-testid="contract-price-tax"]')
  expect(tax[0]?.textContent).toBe('—')
  expect(tax[1]?.textContent).toBe('0%')
  const source = page.getByRole('link', { name: '原吨合同' })
  await expect.element(source).toHaveAttribute('href', '/contract/price-a?contractKind=material&origin=real')
  await page.getByText('按明确依据换算比较单位', { exact: true }).element().focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('combobox', { name: '选择换算合同明细' })).toBeVisible()
  await userEvent.tab()
  const selection = page.getByRole('combobox', { name: '选择换算合同明细' })
  await expect.element(selection).toHaveFocus()
  await selection.selectOptions(JSON.stringify(['real', 'price-a', 'line-a']))
  await page.getByRole('textbox', { name: '合同价格比较单位' }).fill('千克')
  await page.getByRole('spinbutton', { name: '合同价格换算倍数' }).fill('1000')
  await expect.element(page.getByRole('status')).toHaveTextContent('缺少可靠')
  expect(document.querySelector('[data-testid="contract-price-comparison"]')?.textContent).toContain('吨 / ¥18,000.00')
  await page.getByRole('textbox', { name: '合同价格换算依据' }).fill('原文核实1吨=1000千克')
  await expect.poll(() => document.querySelector('[data-testid="contract-price-comparison"]')?.textContent).toContain('千克 / ¥18.00')
  expect(rows[0]).toMatchObject({ unit: '吨', quantity: 1, taxInclusiveUnitPrice: 18000, applicableTaxRate: null })
  await page.getByRole('spinbutton', { name: '合同价格换算倍数' }).fill('0')
  await expect.element(page.getByRole('status')).toHaveTextContent('缺少可靠')
  await page.getByRole('searchbox', { name: '搜索合同价格材料 / 规格 / 材质' }).fill('304')
  expect(document.querySelectorAll('[data-testid="contract-price-row"]')).toHaveLength(1)
  await page.getByRole('searchbox', { name: '搜索合同价格材料 / 规格 / 材质' }).fill('不存在')
  await expect.element(page.getByRole('status')).toHaveTextContent('暂无符合条件')
  await page.getByRole('searchbox', { name: '搜索合同价格材料 / 规格 / 材质' }).fill('')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  const scroll = page.getByRole('region', { name: '合同约定价格表' }).element() as HTMLElement
  if (scroll.scrollWidth > scroll.clientWidth) {
    scroll.scrollLeft = scroll.scrollWidth
    await expect.poll(() => scroll.scrollLeft).toBeGreaterThan(0)
  }
})

it('协议价格真实追溯到中央父合同协议页签', async () => {
  const protocol: ContractPriceFact = { dataOrigin: 'real', contractId: 'protocol-actual', lineId: 'line-actual', parentContractId: 'parent-actual', contractName: '真实补充协议', contractNo: 'BC-01', supplierId: null, supplierName: null, projectId: null, projectName: null, date: null, materialName: '协议原材料', spec: '', materialGrade: '', unit: '米', quantity: 1, taxInclusiveUnitPrice: 0, applicableTaxRate: null }
  await render(defineComponent({ setup: () => () => h(ContractPriceTable, { rows: [protocol] }) }), {
    global: { components: { NuxtLink: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }) } },
  })
  const source = page.getByRole('link', { name: '真实补充协议' })
  await expect.element(source).toHaveAttribute('href', '/contract/parent-actual?contractKind=material&origin=real&tab=supplements&supplementId=protocol-actual')
})
