import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { Toaster } from 'vue-sonner'
import ToastHost from '~/components/shared/ToastHost.vue'

describe('toastHost lane contract', () => {
  it('mounts one expanded system lane and one compact process lane', () => {
    const wrapper = mount(ToastHost)
    const toasters = wrapper.findAllComponents(Toaster)

    expect(toasters).toHaveLength(2)
    expect(toasters[0]?.props()).toMatchObject({
      id: 'system',
      position: 'top-right',
      expand: true,
      visibleToasts: 6,
    })
    expect(toasters[1]?.props()).toMatchObject({
      id: 'process',
      position: 'bottom-right',
      expand: false,
      visibleToasts: 3,
    })
  })
})
