import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import FormFooter from '~/components/ui/FormFooter.vue'

describe('formFooter public behavior', () => {
  it('renders all actions in the canonical order with draft disabled when clean', () => {
    render(FormFooter, {
      props: {
        dirty: false,
      },
    })

    const buttons = screen.getAllByRole<HTMLButtonElement>('button')
    expect(buttons.map(button => button.textContent?.trim())).toEqual([
      '取消',
      '保存草稿',
      '保存并新建',
      '保存并提交',
      '保存',
    ])
    expect(buttons.every(button => button.dataset.state === 'default')).toBe(true)
    expect(buttons[1]?.disabled).toBe(true)
    expect(buttons[0]?.disabled).toBe(false)
    expect(buttons[4]?.disabled).toBe(false)
  })

  it('emits only the requested action and does not own cancel confirmation', async () => {
    const onAction = vi.fn()
    render(FormFooter, {
      props: {
        dirty: true,
        onAction,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    expect(onAction.mock.calls).toEqual([
      ['cancel'],
      ['draft'],
    ])
  })

  it('crops actions without changing their canonical order', () => {
    render(FormFooter, {
      props: {
        actions: ['save', 'cancel', 'saveSubmit'],
        dirty: true,
      },
    })

    expect(screen.getAllByRole('button').map(button => button.textContent?.trim()))
      .toEqual(['取消', '保存并提交', '保存'])
  })

  it('allows a business form to override an action label', () => {
    render(FormFooter, {
      props: {
        actions: ['cancel', 'saveSubmit'],
        labels: { saveSubmit: '保存并入库' },
        dirty: true,
      },
    })

    expect(screen.getByRole('button', { name: '保存并入库' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '保存并提交' })).toBeNull()
  })

  it('two-way binds the optional close-after-save checkbox', async () => {
    const onUpdate = vi.fn()
    render(FormFooter, {
      props: {
        'dirty': true,
        'closeAfterSave': true,
        'modelValue': false,
        'onUpdate:modelValue': onUpdate,
      },
    })

    await fireEvent.click(screen.getByRole('checkbox', { name: '【保存】后关闭' }))

    expect(onUpdate).toHaveBeenCalledWith(true)
  })

  it('uses KitButton loading state and blocks parallel actions', () => {
    render(FormFooter, {
      props: {
        dirty: true,
        loadingAction: 'saveSubmit',
      },
    })

    const submitting = screen.getByRole<HTMLButtonElement>('button', { name: '保存并提交' })
    expect(submitting.dataset.state).toBe('loading')
    expect(submitting.getAttribute('aria-busy')).toBe('true')
    expect(screen.getAllByRole<HTMLButtonElement>('button').every(button => button.disabled))
      .toBe(true)
  })

  it('does not trigger native form submit for action-driven buttons', async () => {
    const onAction = vi.fn()
    const onSubmit = vi.fn()

    render(defineComponent({
      components: { FormFooter },
      setup: () => ({ onAction, onSubmit }),
      template: `
        <form @submit.prevent="onSubmit">
          <FormFooter :dirty="true" @action="onAction" />
        </form>
      `,
    }))

    await fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(onAction).toHaveBeenCalledWith('cancel')
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
