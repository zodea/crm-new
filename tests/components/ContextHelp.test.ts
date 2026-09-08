import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import ContextHelp from '~/components/ui/ContextHelp.vue'

const helpText = '官网未查到不等于小规模纳税人。'

describe('就近帮助', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 24, 24))
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1024)
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(768)
  })

  afterEach(() => vi.restoreAllMocks())

  it('默认不占说明空间，键盘聚焦可读短说明，Escape 关闭且焦点不跳走', async () => {
    render(ContextHelp, { props: { label: '纳税人类型', text: helpText } })
    const trigger = screen.getByRole('button', { name: '查看纳税人类型说明' })
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()
    trigger.focus()

    const tooltip = await screen.findByRole('tooltip', { hidden: true })
    expect(tooltip.textContent).toContain(helpText)
    expect(document.activeElement).toBe(trigger)
    await fireEvent.keyDown(trigger, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  it('悬停可查看，点击将短说明切换为可停留的详情并支持关闭返回', async () => {
    render(ContextHelp, {
      props: { label: '纳税人类型', text: helpText },
      slots: { default: '<a href="#verification">查看核验记录</a>' },
    })
    const trigger = screen.getByRole('button', { name: '查看纳税人类型说明' })
    await fireEvent.pointerMove(trigger, { pointerType: 'mouse' })
    expect((await screen.findByRole('tooltip', { hidden: true })).textContent).toContain(helpText)

    await fireEvent.click(trigger)
    const popover = await screen.findByRole('dialog', { name: '查看纳税人类型说明' })
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()
    expect(screen.getByRole('link', { name: '查看核验记录' })).not.toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    await fireEvent.keyDown(popover, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()
  })

  it('点按不会提交表单或触发行操作，外部输入仍可继续', async () => {
    const submit = vi.fn()
    const rowAction = vi.fn()
    render(defineComponent({
      setup: () => () => h('form', { onSubmit: submit, onClick: rowAction }, [
        h(ContextHelp, { label: '金额口径', text: '按当前查询匹配的全部记录汇总。' }),
        h('input', { 'aria-label': '金额', 'value': '50' }),
      ]),
    }))
    const trigger = screen.getByRole('button', { name: '查看金额口径说明' })
    await fireEvent.pointerDown(trigger, { pointerType: 'touch' })
    await fireEvent.pointerUp(trigger, { pointerType: 'touch' })
    await fireEvent.click(trigger)
    expect(await screen.findByRole('dialog', { name: '查看金额口径说明' })).not.toBeNull()
    expect(rowAction).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()

    const input = screen.getByRole('textbox', { name: '金额' })
    input.focus()
    await fireEvent.update(input, '60')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(input)
    expect((input as HTMLInputElement).value).toBe('60')
  })
})
