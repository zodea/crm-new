import type { OtherSettlementDetail } from '~/lib/other-settlement/contract'
import { mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { computed, defineComponent, ref, useTemplateRef, watch } from 'vue'
import OtherSettlementInfo from '~/pages/contract/other-settlement/_components/OtherSettlementInfo.vue'

const audit = (name: string) => ({ createdBy: `创建-${name}`, updatedBy: `修改-${name}`, createdAt: `创建时间-${name}`, updatedAt: `修改时间-${name}`, responsible: `负责-${name}`, department: `部门-${name}` })
const attachment = (id: string) => ({ id, fileName: `${id}.pdf`, ownerType: 'expenditure_settlement', ownerId: 'synthetic', filePath: '', fileSize: 1, mimeType: 'application/pdf', category: '', uploader: '', uploadedAt: null, deletedAt: null })
function makeDetail(): OtherSettlementDetail {
  const relation = { id: null, entity: 'project', state: 'missing', label: null }
  return {
    settlement: { id: 'synthetic', version: '2', project: relation, contract: { ...relation, entity: 'contract' }, supplier: { ...relation, entity: 'supplier' }, draft: { name: '当前结算', payeeNameSnapshot: '当前收款人' }, amounts: { contract: null, changedContract: null, prior: null, total: null, deductions: null, net: null, taxExclusive: null, tax: null, cumulative: null, applied: null, applicable: null, paid: null, unpaid: null }, audit: audit('当前') },
    facts: [],
    capabilities: ['other-settlement:read'],
    attachments: [attachment('current')],
    history: [
      { version: '1', actorId: '操作人-旧', commandId: '命令-旧', occurredAt: '时间-旧', record: { id: 'synthetic', version: 1, workspaceId: 'synthetic', migrationBatchId: null, draft: { name: '旧结算', totalAmount: 0, payeeNameSnapshot: '旧收款人', originalExpenses: [{ originalExpenseLineId: '原费-旧', sourceVersion: '来源-旧', sourceRevision: '修订-旧', amount: 0 }] }, attachments: [attachment('old')], audit: audit('旧'), facts: null } },
      { version: '2', actorId: '操作人-新', commandId: '命令-新', occurredAt: '时间-新', record: { id: 'synthetic', version: 2, workspaceId: 'synthetic', migrationBatchId: null, draft: { name: '当前结算', totalAmount: 80, payeeNameSnapshot: '当前收款人', originalExpenses: [{ originalExpenseLineId: '原费-新', sourceVersion: '来源-新', sourceRevision: '修订-新', amount: 80 }] }, attachments: [attachment('current')], audit: audit('当前'), facts: null } },
    ],
  } as unknown as OtherSettlementDetail
}

function mountHistory(detail: OtherSettlementDetail) {
  for (const [key, value] of Object.entries({ computed, ref, watch, useTemplateRef, useOtherSettlementNavigation: () => ({ context: () => ({}), remember: () => {} }) })) vi.stubGlobal(key, value)
  const SectionHeader = defineComponent({ props: ['title'], template: '<h2>{{ title }}</h2>' })
  const OtherSettlementOriginalFiles = defineComponent({ props: ['files', 'version', 'canRead'], template: '<div><span>原件版本 {{ version }}</span><span v-for="file in files" :key="file.id">{{ file.fileName }}</span></div>' })
  const NuxtLink = defineComponent({ props: ['to'], template: '<a :href="to"><slot /></a>' })
  return mount(OtherSettlementInfo, { props: { detail }, global: { components: { SectionHeader, NuxtLink }, stubs: { OtherSettlementOriginalFiles } } })
}

afterEach(() => vi.unstubAllGlobals())

it('选择不同冻结版本时展示各自原费用、零金额、审计和对应附件', async () => {
  const wrapper = mountHistory(makeDetail())
  const select = wrapper.get('select')
  await select.setValue('1')
  const section = select.element.closest('section')!
  expect(section.textContent).toContain('原费-旧')
  expect(section.textContent).toContain('来源-旧')
  expect(section.textContent).toContain('修订-旧')
  expect(section.textContent).toContain('0.00')
  expect(section.textContent).toContain('旧收款人')
  expect(section.textContent).toContain('操作人-旧')
  expect(section.textContent).toContain('命令-旧')
  expect(section.textContent).toContain('修改-旧')
  expect(section.textContent).toContain('old.pdf')
  expect(section.textContent).not.toContain('current.pdf')
  expect(wrapper.text()).toContain('前期信息（当前）')
  expect(wrapper.text()).toContain('结算信息（当前）')
  expect(wrapper.text()).toContain('累计与应付信息（当前）')
  await select.setValue('2')
  expect(section.textContent).toContain('原费-新')
  expect(section.textContent).toContain('命令-新')
  expect(section.textContent).toContain('current.pdf')
  expect(section.textContent).not.toContain('old.pdf')
  wrapper.unmount()
})

it('选择的旧版本来源消失时明确缺口，不回退成当前附件或当前审计', async () => {
  const detail = makeDetail()
  const wrapper = mountHistory(detail)
  const select = wrapper.get('select')
  await select.setValue('1')
  await wrapper.setProps({ detail: { ...detail, history: detail.history!.filter(row => row.version === '2') } })
  const section = wrapper.get('select').element.closest('section')!
  expect(section.textContent).toContain('冻结版本不可用')
  expect(section.textContent).not.toContain('current.pdf')
  expect(section.textContent).not.toContain('修改-当前')
  expect(section.textContent).not.toContain('原费-新')
  wrapper.unmount()
})

it('当前版本缺少冻结历史时只标示当前附件，不冒充冻结资料', () => {
  const detail = makeDetail()
  const wrapper = mountHistory({ ...detail, history: undefined })
  expect(wrapper.text()).toContain('冻结版本不可用')
  expect(wrapper.text()).toContain('以下仅为当前附件')
  expect(wrapper.text()).toContain('current.pdf')
  expect(wrapper.text()).not.toContain('原费-新')
  wrapper.unmount()
})

it('冻结原费用缺失与真实零金额分别显示', async () => {
  const detail = makeDetail()
  detail.history![0]!.record.draft.originalExpenses = undefined
  detail.history![0]!.record.draft.totalAmount = null
  const wrapper = mountHistory(detail)
  await wrapper.get('select').setValue('1')
  const section = wrapper.get('select').element.closest('section')!
  expect(section.textContent).toContain('含税金额 未知')
  expect(section.textContent).toMatch(/冻结原费用引用\s*未记录/)
  expect(section.textContent).not.toContain('原费-新')
  wrapper.unmount()
})

it('冻结原费用身份和版本缺值明确显示未记录，不猜测当前来源', async () => {
  const detail = makeDetail()
  detail.history![0]!.record.draft.originalExpenses = [{ originalExpenseLineId: '', sourceVersion: '', sourceRevision: '', amount: null }]
  const wrapper = mountHistory(detail)
  await wrapper.get('select').setValue('1')
  const section = wrapper.get('select').element.closest('section')!
  expect(section.textContent).toMatch(/原费用行 ID\s*未记录/)
  expect(section.textContent).toMatch(/来源版本\s*未记录/)
  expect(section.textContent).toMatch(/来源修订\s*未记录/)
  expect(section.textContent).toMatch(/采用金额\s*未知/)
  expect(section.textContent).not.toContain('原费-新')
  wrapper.unmount()
})
