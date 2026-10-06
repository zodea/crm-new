import type { ContractPriceFact } from '~/lib/material-contract/price-facts'
import type { QuotationRead, QuotationRecord } from '~/lib/material-quotation/contract'
import type { DeliveryPriceRecordInput } from '~/lib/material/price-analysis'
import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import QuotationPriceTable from '~/components/material/price/QuotationPriceTable.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import { newQuotationDraft } from '~/lib/material-quotation/contract'
import { decodeQuotationRead } from '~/lib/material-quotation/http-repository'

it('五档真实报价价格页保冻结来源、未知值、真零、条件门禁、局部横滚和键盘焦点', async () => {
  const at = '2026-10-05T00:00:00.000Z'
  const draft = { ...newQuotationDraft(), partyName: '原报价方', lines: [{ ...newQuotationDraft().lines[0]!, id: 'quote-line-a', name: '原材料', unit: '吨', unitPrice: 0, taxRate: null }] }
  const later = { ...draft, lines: [{ ...draft.lines[0]!, unitPrice: 18000, quantity: 1 }] }
  const meta = { schemaVersion: 'material-quotation-read-v1', workspaceId: 'workspace-quote', actorId: 'actor-quote', dataOrigin: 'real', asOf: at, sourceVersion: 'quote-source-2', sources: [{ key: 'material-quotations', state: 'readable', sourceVersion: 'quote:2', asOf: at }], authorizedScope: { coverage: 'complete', fingerprint: 'scope-quote' }, capabilities: ['material-quotation:read'] }
  const read = decodeQuotationRead({ records: [{ id: 'quotation-head', draft: later, attachments: [], version: '2', createdAt: at, updatedAt: at, history: [{ version: '1', draft, files: [], actorId: 'actor-quote', commandId: 'command-one', occurredAt: at }, { version: '2', draft: later, files: [], actorId: 'actor-quote', commandId: 'command-two', occurredAt: at }] }], meta, asOf: at, sourceVersion: meta.sourceVersion, capabilities: meta.capabilities })
  await render(defineComponent({ setup: () => () => h('main', { style: { padding: '12px', maxWidth: '100%', minWidth: '0' } }, h(QuotationPriceTable, { read })) }), { global: { components: { SectionHeader, NuxtLink: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }) } } })
  await expect.element(page.getByRole('link', { name: '报价版本 1' })).toHaveAttribute('href', '/material/quotations/quotation-head?version=1')
  await expect.element(page.getByRole('link', { name: '报价版本 2' })).toHaveAttribute('href', '/material/quotations/quotation-head?version=2')
  await expect.element(page.getByText('原日期未知').first()).toBeVisible()
  const select = page.getByRole('button', { name: '比较 原报价方 版本 2 原材料' })
  select.element().focus()
  await userEvent.keyboard('{Enter}')
  await page.getByRole('textbox', { name: '报价比较单位' }).fill('千克')
  await page.getByRole('spinbutton', { name: '报价换算系数' }).fill('1000')
  await expect.element(page.getByRole('status')).toHaveTextContent('真实依据')
  await page.getByRole('textbox', { name: '报价换算依据' }).fill('原文1吨=1000千克')
  await expect.element(page.getByRole('status')).toHaveTextContent('本次换算原价：18 / 千克')
  expect(read.records[0]!.history[0]!.draft.lines[0]).toMatchObject({ unitPrice: 0, taxRate: null })
  expect(read.records[0]!.draft.lines[0]).toMatchObject({ unit: '吨', unitPrice: 18000, quantity: 1 })
  await page.getByRole('textbox', { name: '报价换算依据' }).element().focus()
  await userEvent.tab()
  await expect.element(page.getByRole('combobox', { name: '基准原价' })).toHaveFocus()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  const scroll = page.getByRole('region', { name: '报价原价横向滚动区域' }).element()
  if (window.innerWidth < 1180) {
    expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth)
    scroll.scrollLeft = 0
    scroll.focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.poll(() => scroll.scrollLeft).toBeGreaterThan(0)
  }
})
it('五档三来源实际原行与项目/稳定身份筛选、原件定位和未知税比较门禁', async () => {
  const at = '2026-10-05T00:00:00.000Z'
  const quote = (id: string, scope: 'general' | 'project' | 'unknown', projectId: string | null, supplierId: string | null): QuotationRecord => {
    const draft = { ...newQuotationDraft(), partyName: '同名原报价方', scope, projectId, supplierId, lines: [{ ...newQuotationDraft().lines[0]!, id: `${id}-line`, name: '原材料', unit: '米', unitPrice: 0, taxIncluded: true, taxRate: 0, freight: '原运费条件', quantityCondition: '原数量条件', paymentCondition: '原付款条件', validity: '原有效期' }] }
    return { id, draft, version: '1', createdAt: at, updatedAt: at, attachments: [], history: [{ version: '1', draft, files: [], actorId: 'original-actor', commandId: `${id}-command`, occurredAt: at }] }
  }
  const records = [quote('quote-general', 'general', null, null), quote('quote-one', 'project', 'project-one', 'supplier-one'), quote('quote-two', 'project', 'project-two', 'supplier-two'), quote('quote-unknown', 'unknown', null, null)]
  const meta = { schemaVersion: 'material-quotation-read-v1', workspaceId: 'workspace-quote', actorId: 'actor-quote', dataOrigin: 'real', asOf: at, sourceVersion: 'actual-quote-source', sources: [{ key: 'material-quotations', state: 'readable', sourceVersion: 'quote:4', asOf: at }], authorizedScope: { coverage: 'complete', fingerprint: 'actual-quote-scope' }, capabilities: ['material-quotation:read'] }
  const read = decodeQuotationRead({ records, meta, asOf: at, sourceVersion: meta.sourceVersion, capabilities: meta.capabilities }) as QuotationRead
  const contractRows: ContractPriceFact[] = [{ dataOrigin: 'real', contractId: 'actual-contract', lineId: 'actual-contract-line', parentContractId: null, contractName: '真实合同', contractNo: 'CQ-001', supplierId: 'supplier-one', supplierName: '同名原报价方', projectId: 'project-one', projectName: '真实项目甲', date: '2026-10-01', materialName: '原材料', spec: '原规格', materialGrade: '原材质', unit: '米', quantity: 1, taxInclusiveUnitPrice: 20, applicableTaxRate: null }]
  const deliveries: DeliveryPriceRecordInput[] = [{ dataOrigin: 'real', id: 'actual-delivery', version: '9', assetId: 'actual-source-original', projectId: 'project-one', supplierId: 'supplier-one', orderNo: 'DL-001', deliveryDate: '2026-10-02', archived: true, reviewStatus: 'reviewed', ocrStatus: 'done', naturalKeyDuplicate: false, currentValuesConfirmed: true, hasSourceFile: true, lines: [{ id: 'actual-delivery-line', materialName: '原材料', spec: '原规格', unit: '米', unitPrice: 0, amount: 0, qty: 1, currentValueConfirmed: true }] }]
  await render(defineComponent({ setup: () => () => h('main', { style: { padding: '12px', maxWidth: '100%', minWidth: '0' } }, h(QuotationPriceTable, { read, contractRows, records: deliveries, suppliers: [{ id: 'supplier-one', name: '实际分供方甲' }, { id: 'supplier-two', name: '实际分供方乙' }] })) }), { global: { components: { SectionHeader, NuxtLink: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }) } } })
  await expect.element(page.getByRole('link', { name: '真实合同', exact: true })).toHaveAttribute('href', '/contract/actual-contract?contractKind=material&origin=real')
  await expect.element(page.getByRole('link', { name: 'DL-001', exact: true })).toHaveAttribute('href', '/material/delivery/archive/actual-delivery?origin=real')
  await page.getByRole('combobox', { name: '原价项目范围' }).selectOptions('project-one')
  await expect.element(page.getByText('quote-general-line', { exact: true })).toBeVisible()
  await expect.element(page.getByText('quote-one-line', { exact: true })).toBeVisible()
  await expect.element(page.getByText('quote-two-line', { exact: true })).not.toBeInTheDocument()
  await expect.element(page.getByText('quote-unknown-line', { exact: true })).not.toBeInTheDocument()
  await page.getByRole('combobox', { name: '原价分供方身份' }).selectOptions('id:supplier-one')
  await expect.element(page.getByText('quote-general-line', { exact: true })).not.toBeInTheDocument()
  await expect.element(page.getByText('quote-one-line', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '比较 合同约定价 真实合同 actual-contract-line' }).click()
  await page.getByRole('textbox', { name: '报价比较单位' }).fill('米')
  await page.getByRole('spinbutton', { name: '报价换算系数' }).fill('1')
  await page.getByRole('textbox', { name: '报价换算依据' }).fill('按原单位核对')
  await page.getByRole('combobox', { name: '基准原价' }).selectOptions('quotation:quote-one:1:quote-one-line')
  await page.getByRole('textbox', { name: '材料核对依据' }).fill('原件规格与等级逐项核对')
  await expect.element(page.getByText('价差未计算 · 税口径或本行适用税率未知，不能计算价差')).toBeVisible()
  await page.getByRole('combobox', { name: '原价分供方身份' }).selectOptions('unlinked')
  await expect.element(page.getByText('quote-general-line', { exact: true })).toBeVisible()
  await expect.element(page.getByRole('textbox', { name: '报价比较单位' })).not.toBeInTheDocument()
  expect(read.records[0]!.draft.supplierId).toBeNull()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
})
