import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import LookupSelect from '~/components/ui/LookupSelect.vue'

const { warning } = vi.hoisted(() => ({
  warning: vi.fn(() => 'toast-warning'),
}))

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), {
    warning,
  }),
}))

afterEach(() => {
  localStorage.clear()
})

describe('lookupSelect public behavior', () => {
  it('debounces search, highlights results, and emits the selected id', async () => {
    vi.useFakeTimers()
    const fetchOptions = vi.fn(async () => [
      { id: 'project-1', label: '车陂项目', hint: '广州市天河区' },
    ])
    const onUpdate = vi.fn()

    render(LookupSelect, {
      props: {
        'fetch': fetchOptions,
        'placeholder': '选择项目',
        'onUpdate:modelValue': onUpdate,
      },
    })

    const input = screen.getByRole('combobox', { name: '选择项目' })
    await fireEvent.focus(input)
    await fireEvent.update(input, '车')

    await vi.advanceTimersByTimeAsync(299)
    expect(fetchOptions).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await nextTick()
    expect(fetchOptions).toHaveBeenCalledOnce()
    expect(fetchOptions).toHaveBeenCalledWith('车')

    const option = await screen.findByRole('option', { name: /车陂项目/ })
    expect(option.querySelector('mark')?.textContent).toBe('车')

    await fireEvent.click(option)
    expect(onUpdate).toHaveBeenCalledWith('project-1')
    await fireEvent.click(screen.getByRole('button', { name: '清空选择' }))
    expect(onUpdate).toHaveBeenLastCalledWith(null)
    expect(screen.queryByRole('button', { name: '清空选择' })).toBeNull()
  })

  it('keeps dependency-disabled fields closed and reports the reason', async () => {
    const reason = '该字段依赖“项目名称”的值，请补全后操作'
    localStorage.setItem('kit-lookup:disabled-projects:recent', JSON.stringify([
      { id: 'project-1', label: '车陂项目' },
    ]))
    render(LookupSelect, {
      props: {
        fetch: vi.fn(async () => []),
        modelValue: 'project-1',
        recentKey: 'disabled-projects',
        allowCreate: true,
        disabledReason: reason,
        placeholder: '选择合同',
      },
    })

    const input = screen.getByRole('combobox', { name: '选择合同' })
    await fireEvent.click(screen.getByRole('button', { name: reason }))

    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(warning).toHaveBeenCalledWith(
      reason,
      expect.objectContaining({ toasterId: 'system' }),
    )
    expect((input as HTMLInputElement).disabled).toBe(true)
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('closes an open lookup when its dependency becomes unavailable', async () => {
    const fetchOptions = vi.fn(async () => [])
    const { rerender } = render(LookupSelect, {
      props: {
        fetch: fetchOptions,
        placeholder: '选择合同',
      },
    })
    const input = screen.getByRole('combobox', { name: '选择合同' })

    await fireEvent.focus(input)
    expect(input.getAttribute('aria-expanded')).toBe('true')

    await rerender({
      fetch: fetchOptions,
      disabledReason: '请先选择项目',
      placeholder: '选择合同',
    })
    await nextTick()

    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect((input as HTMLInputElement).disabled).toBe(true)
  })

  it('emits create from the field-tail action', async () => {
    const onCreate = vi.fn()
    render(LookupSelect, {
      props: {
        fetch: vi.fn(async () => []),
        allowCreate: true,
        placeholder: '选择分供方',
        onCreate,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: '新建选项' }))

    expect(onCreate).toHaveBeenCalledOnce()
  })

  it('restores the selected label from recent storage for an id-only model', () => {
    localStorage.setItem('kit-lookup:projects:recent', JSON.stringify([
      { id: 'project-1', label: '车陂项目' },
    ]))

    render(LookupSelect, {
      props: {
        fetch: vi.fn(async () => []),
        modelValue: 'project-1',
        recentKey: 'projects',
        placeholder: '选择项目',
      },
    })

    expect(screen.getByRole<HTMLInputElement>('combobox', { name: '选择项目' }).value)
      .toBe('车陂项目')
  })

  it('resolves an id-only model through the public fetch contract', async () => {
    vi.useFakeTimers()
    const fetchOptions = vi.fn(async () => [
      { id: 'project-1', label: '车陂项目' },
    ])

    render(LookupSelect, {
      props: {
        fetch: fetchOptions,
        modelValue: 'project-1',
        placeholder: '选择项目',
      },
    })

    await vi.advanceTimersByTimeAsync(300)
    await nextTick()

    expect(fetchOptions).toHaveBeenCalledWith('')
    expect(screen.getByRole<HTMLInputElement>('combobox', { name: '选择项目' }).value)
      .toBe('车陂项目')
  })

  it('reuses an in-flight request when input changes from A to B and back to A', async () => {
    vi.useFakeTimers()
    let resolveAlpha!: (options: Array<{ id: string, label: string }>) => void
    const alpha = new Promise<Array<{ id: string, label: string }>>((resolve) => {
      resolveAlpha = resolve
    })
    const fetchOptions = vi.fn((keyword: string) =>
      keyword === 'A' ? alpha : Promise.resolve([]),
    )

    render(LookupSelect, {
      props: {
        fetch: fetchOptions,
        placeholder: '选择项目',
      },
    })

    const input = screen.getByRole('combobox', { name: '选择项目' })
    await fireEvent.focus(input)
    await fireEvent.update(input, 'A')
    await vi.advanceTimersByTimeAsync(300)
    expect(fetchOptions).toHaveBeenCalledTimes(1)

    await fireEvent.update(input, 'B')
    await vi.advanceTimersByTimeAsync(100)
    await fireEvent.update(input, 'A')
    await vi.advanceTimersByTimeAsync(300)
    expect(fetchOptions).toHaveBeenCalledTimes(1)

    resolveAlpha([{ id: 'alpha', label: 'Alpha 项目' }])
    await flushPromises()
    await nextTick()

    expect(screen.getByRole('option', { name: 'Alpha 项目' })).toBeTruthy()
    expect(screen.queryByText('正在搜索…')).toBeNull()
  })

  it('hides stale results as soon as a new keyword is queued', async () => {
    vi.useFakeTimers()
    const fetchOptions = vi.fn(async (keyword: string) => [
      { id: keyword.toLocaleLowerCase(), label: `${keyword} 项目` },
    ])
    const onUpdate = vi.fn()

    render(LookupSelect, {
      props: {
        'fetch': fetchOptions,
        'placeholder': '选择项目',
        'onUpdate:modelValue': onUpdate,
      },
    })

    const input = screen.getByRole('combobox', { name: '选择项目' })
    await fireEvent.focus(input)
    await fireEvent.update(input, 'A')
    await vi.advanceTimersByTimeAsync(300)
    await nextTick()
    expect(await screen.findByRole('option', { name: 'A 项目' })).toBeTruthy()

    await fireEvent.update(input, 'B')
    expect(screen.queryByRole('option', { name: 'A 项目' })).toBeNull()
    expect(screen.getByText('正在搜索…')).toBeTruthy()

    await fireEvent.keyDown(input, { key: 'ArrowDown' })
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(onUpdate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)
    await nextTick()
    expect(await screen.findByRole('option', { name: 'B 项目' })).toBeTruthy()
  })

  it('clears an old label and resolves a parent-controlled id change', async () => {
    vi.useFakeTimers()
    let available = [{ id: 'project-a', label: '项目 A' }]
    const fetchOptions = vi.fn(async () => available)
    const { rerender } = render(LookupSelect, {
      props: {
        fetch: fetchOptions,
        modelValue: 'project-a',
        placeholder: '选择项目',
      },
    })
    const input = screen.getByRole<HTMLInputElement>('combobox', { name: '选择项目' })
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    await nextTick()
    expect(input.value).toBe('项目 A')
    expect(fetchOptions).toHaveBeenCalledTimes(1)

    available = [{ id: 'project-b', label: '项目 B' }]
    await rerender({
      fetch: fetchOptions,
      modelValue: 'project-b',
      placeholder: '选择项目',
    })
    await nextTick()
    expect(input.value).toBe('')

    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    await nextTick()

    expect(fetchOptions).toHaveBeenCalledWith('')
    expect(fetchOptions).toHaveBeenCalledTimes(2)
    expect(input.value).toBe('项目 B')
  })

  it('invalidates late results when a dependency context changes', async () => {
    vi.useFakeTimers()
    let context = 'A'
    let resolveA!: (options: Array<{ id: string, label: string }>) => void
    let resolveB!: (options: Array<{ id: string, label: string }>) => void
    const fetchOptions = vi.fn(() =>
      new Promise<Array<{ id: string, label: string }>>((resolve) => {
        if (context === 'A')
          resolveA = resolve
        else
          resolveB = resolve
      }),
    )
    const { rerender } = render(LookupSelect, {
      props: {
        fetch: fetchOptions,
        placeholder: '选择合同',
      },
    })
    const input = screen.getByRole('combobox', { name: '选择合同' })

    await fireEvent.focus(input)
    await fireEvent.update(input, '同一关键词')
    await vi.advanceTimersByTimeAsync(300)
    expect(fetchOptions).toHaveBeenCalledTimes(1)

    await rerender({
      fetch: fetchOptions,
      disabledReason: '请先选择新项目',
      placeholder: '选择合同',
    })
    context = 'B'
    resolveA([{ id: 'contract-a', label: '项目 A 的合同' }])
    await flushPromises()
    await nextTick()
    expect(screen.queryByRole('option', { name: '项目 A 的合同' })).toBeNull()

    await rerender({
      fetch: fetchOptions,
      disabledReason: undefined,
      placeholder: '选择合同',
    })
    await fireEvent.blur(input)
    await fireEvent.focus(input)
    expect(input.getAttribute('aria-expanded')).toBe('true')
    await fireEvent.update(input, '同一关键词')
    await vi.advanceTimersByTimeAsync(300)
    expect(fetchOptions).toHaveBeenCalledTimes(2)

    resolveB([{ id: 'contract-b', label: '项目 B 的合同' }])
    await flushPromises()
    await nextTick()
    expect(screen.getByRole('option', { name: '项目 B 的合同' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: '项目 A 的合同' })).toBeNull()
  })

  it('starts a new id-resolution request when the controlled id changes in flight', async () => {
    vi.useFakeTimers()
    let resolveFirst!: (options: Array<{ id: string, label: string }>) => void
    let resolveSecond!: (options: Array<{ id: string, label: string }>) => void
    const fetchOptions = vi.fn(() =>
      new Promise<Array<{ id: string, label: string }>>((resolve) => {
        if (fetchOptions.mock.calls.length === 1)
          resolveFirst = resolve
        else
          resolveSecond = resolve
      }),
    )
    const { rerender } = render(LookupSelect, {
      props: {
        fetch: fetchOptions,
        modelValue: 'project-a',
        placeholder: '选择项目',
      },
    })
    const input = screen.getByRole<HTMLInputElement>('combobox', { name: '选择项目' })

    await vi.advanceTimersByTimeAsync(300)
    expect(fetchOptions).toHaveBeenCalledTimes(1)

    await rerender({
      fetch: fetchOptions,
      modelValue: 'project-b',
      placeholder: '选择项目',
    })
    await vi.advanceTimersByTimeAsync(300)
    expect(fetchOptions).toHaveBeenCalledTimes(2)

    resolveFirst([{ id: 'project-a', label: '项目 A' }])
    await flushPromises()
    await nextTick()
    expect(input.value).toBe('')

    resolveSecond([{ id: 'project-b', label: '项目 B' }])
    await flushPromises()
    await nextTick()
    expect(input.value).toBe('项目 B')
  })
})
