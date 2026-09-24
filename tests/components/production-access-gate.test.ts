import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import ProductionAccessGate from '../../app/components/shared/ProductionAccessGate.vue'
import { useProductionAccessStore } from '../../app/stores/production-access'

afterEach(() => vi.unstubAllGlobals())
it('已认证后的连接失败遮挡但不卸载输入，明确过期才卸载业务页', async () => {
  const status = { mode: 'production', authenticated: true, purpose: 'verification', ownerId: 'synthetic-owner', expiresAt: '2026-09-23T00:00:00.000Z' }
  const read = vi.fn().mockResolvedValueOnce(status).mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValueOnce(status).mockResolvedValueOnce({ mode: 'production', authenticated: false, purpose: 'verification' })
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { productionAccess: { status: read } } }))
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(ProductionAccessGate, { global: { plugins: [pinia] }, slots: { default: '<input aria-label="尚未保存客户" value="未保存字段和附件所在页">' } })
  const store = useProductionAccessStore()
  await vi.waitFor(() => expect(wrapper.find('input[aria-label="尚未保存客户"]').exists()).toBe(true))
  const original = wrapper.find('input[aria-label="尚未保存客户"]').element
  await store.check()
  await nextTick()
  expect(wrapper.find('input[aria-label="尚未保存客户"]').element).toBe(original)
  expect(wrapper.find('[inert]').exists()).toBe(true)
  expect(wrapper.text()).toContain('连接暂不可用')
  await store.check()
  await nextTick()
  expect(wrapper.find('input[aria-label="尚未保存客户"]').element).toBe(original)
  expect(wrapper.find('[inert]').exists()).toBe(false)
  await store.check()
  await nextTick()
  expect(wrapper.find('input[aria-label="尚未保存客户"]').exists()).toBe(false)
  wrapper.unmount()
})
