import { fireEvent, render, screen } from '@testing-library/vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { nextTick } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'

describe('kitButton public contract', () => {
  it('renders a usable default button and forwards click', async () => {
    const onClick = vi.fn()
    const { container } = render(KitButton, {
      attrs: { onClick },
      slots: { default: '保存' },
    })

    const button = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)

    await fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
    expect((await axe(container)).violations).toEqual([])
  })

  it('exposes loading as a disabled busy state without losing the label', () => {
    render(KitButton, {
      props: { loading: true },
      slots: { default: '提交' },
    })

    const button = screen.getByRole('button', { name: '提交' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.textContent).toContain('提交')
  })

  it('announces success and resets the success model after one second', async () => {
    vi.useFakeTimers()
    const wrapper = mount(KitButton, {
      attachTo: document.body,
      props: { success: true },
      slots: { default: '保存' },
    })

    expect(wrapper.get('[role="status"]').text()).toContain('操作已完成')

    await vi.advanceTimersByTimeAsync(1000)
    await nextTick()

    expect(wrapper.emitted('update:success')).toEqual([[false]])
    wrapper.unmount()
  })
})
