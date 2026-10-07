import type { OurSignatoryRecord } from '../../app/lib/our-signatory/contract'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import ContractSignatoryField from '../../app/components/contract/ContractSignatoryField.vue'
import { signatorySnapshot } from '../../app/lib/our-signatory/contract'

const mocks = vi.hoisted(() => ({ list: vi.fn(), desktop: vi.fn(() => false) }))
vi.mock('../../app/lib/our-signatory/http-repository', () => ({ createOurSignatoryRepository: () => ({ list: mocks.list }) }))
vi.mock('../../app/lib/platform/runtime', () => ({ isDesktopRuntime: mocks.desktop }))
const Lookup = defineComponent({ props: ['modelValue', 'fetch', 'disabledReason'], emits: ['update:modelValue'], template: '<input role="combobox" :disabled="Boolean(disabledReason)" />' })
function record(id: string, name: string, status: 'active' | 'inactive' = 'active'): OurSignatoryRecord {
  return { id, version: '2', draft: { name, taxNo: null, registeredAddress: null, legalRepresentative: null, verificationNote: '已核实', status }, history: [], createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z' }
}
const render = (draft = {}) => mount(ContractSignatoryField, { props: { draft, label: '甲方（我方）' }, global: { plugins: [createPinia()], stubs: { LookupSelect: Lookup, NuxtLink: true } } })
beforeEach(() => {
  mocks.desktop.mockReturnValue(false)
  mocks.list.mockResolvedValue({ records: [record('company-active', '已核施工公司'), record('company-retired', '停用公司', 'inactive')] })
})

it('动态搜索真目录，按稳定ID采用，未知ID和停用主体不能通过输入冒名', async () => {
  const wrapper = render()
  await flushPromises()
  const lookup = wrapper.getComponent(Lookup)
  const fetch = lookup.props('fetch')
  expect(await fetch('施工')).toEqual([{ id: 'company-active', label: '已核施工公司', hint: undefined }])
  expect(await fetch('company-active')).toHaveLength(1)
  expect(await fetch('停用')).toEqual([])
  lookup.vm.$emit('update:modelValue', 'company-retired')
  lookup.vm.$emit('update:modelValue', '伪造的公司名')
  expect(wrapper.emitted('patch')).toBeUndefined()
  lookup.vm.$emit('update:modelValue', 'company-active')
  expect(wrapper.emitted('patch')?.[0]).toEqual([{ ourSignatoryId: 'company-active', ourSignatoryVersion: '2', ourSignatorySnapshot: signatorySnapshot(record('company-active', '已核施工公司')) }])
  wrapper.unmount()
})

it('原合同停用主体保原快照且不复活，目录失败或Native门禁不能变更采用', async () => {
  const original = { ...signatorySnapshot(record('company-retired', '原文书签约名称')), version: '1' }
  const wrapper = render({ ourSignatoryId: original.id, ourSignatoryVersion: original.version, ourSignatorySnapshot: original })
  await flushPromises()
  const lookup = wrapper.getComponent(Lookup)
  expect(await lookup.props('fetch')('company-retired')).toEqual([{ id: original.id, label: original.name, hint: '合同原快照' }])
  lookup.vm.$emit('update:modelValue', original.id)
  expect(wrapper.emitted('patch')).toBeUndefined()
  expect(wrapper.text()).toContain('原文书签约名称')
  wrapper.unmount()
  mocks.desktop.mockReturnValue(true)
  const native = render()
  await flushPromises()
  expect(native.getComponent(Lookup).props('disabledReason')).toContain('尚未接入')
  native.getComponent(Lookup).vm.$emit('update:modelValue', 'company-active')
  expect(native.emitted('patch')).toBeUndefined()
  native.unmount()
  mocks.desktop.mockReturnValue(false)
  mocks.list.mockRejectedValueOnce(new Error('目录读取失败'))
  const failed = render()
  await flushPromises()
  expect(failed.getComponent(Lookup).props('disabledReason')).toBe('目录读取失败')
  failed.getComponent(Lookup).vm.$emit('update:modelValue', 'company-active')
  expect(failed.emitted('patch')).toBeUndefined()
  failed.unmount()
})
