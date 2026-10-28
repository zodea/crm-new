import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import LookupSelect from '~/components/ui/LookupSelect.vue'
import { useDataVisibilityStore } from '~/stores/data-visibility'

const { warning } = vi.hoisted(() => ({
  warning: vi.fn(() => 'toast-warning'),
}))

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), {
    warning,
  }),
}))

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  localStorage.clear()
})

describe('lookupSelect public behavior', () => {
  it('keeps the selected option available when reopening without a recent list', async () => {
    vi.useFakeTimers()
    const fetchOptions = vi.fn(async () => [
      { id: 'main-a', label: '同工程 · 合同甲' },
      { id: 'main-b', label: '同工程 · 合同乙' },
    ])
    const { rerender } = render(LookupSelect, { props: { fetch: fetchOptions, placeholder: '选择工程', modelValue: null } })
    const input = screen.getByRole('combobox', { name: '选择工程' })
    await fireEvent.focus(input)
    await fireEvent.update(input, '同工程')
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    await fireEvent.click(screen.getByRole('option', { name: '同工程 · 合同乙' }))
    await rerender({ fetch: fetchOptions, placeholder: '选择工程', modelValue: 'main-b' })
    await fireEvent.focus(input)
    await fireEvent.keyDown(input, { key: 'ArrowDown' })
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    expect(screen.getByRole('option', { name: '同工程 · 合同乙' })).toBeTruthy()
    expect(screen.getByRole('option', { name: '同工程 · 合同甲' })).toBeTruthy()
  })

  it('debounces search, highlights results, and emits the selected id', async () => {
    vi.useFakeTimers()
    const fetchOptions = vi.fn(async () => [
      { id: 'project-1', label: '车陂项目', hint: '广州市天河区' },
    ])
    const onUpdate = vi.fn()

    render(LookupSelect, {
      props: {
        'fetch': fetchOptions,
        'field': 'projectId',
        'invalid': true,
        'descriptionId': 'project-error',
        'placeholder': '选择项目',
        'onUpdate:modelValue': onUpdate,
      },
    })

    const input = screen.getByRole('combobox', { name: '选择项目' })
    expect(input.getAttribute('data-field')).toBe('projectId')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe('project-error')
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
    localStorage.setItem('kit-lookup:workspace-default:real:disabled-projects:recent', JSON.stringify([
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
    localStorage.setItem('kit-lookup:workspace-default:real:projects:recent', JSON.stringify([
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

  it.each([null, 'crew-existing'])('真实候选更名刷新近期和已选显示，保留未命中近期项及稳定 ID：%s', async (selectedId) => {
    vi.useFakeTimers()
    const storageKey = 'kit-lookup:workspace-default:real:worker-crews:recent'
    localStorage.setItem(storageKey, JSON.stringify([
      { id: 'crew-existing', label: '班组旧名称', hint: '旧工种' },
      { id: 'crew-unmatched', label: '另一近期班组', hint: '木工' },
    ]))
    const fetchOptions = vi.fn(async () => [{ id: 'crew-existing', label: '班组现行名称', hint: '泥工' }])
    const onUpdate = vi.fn()
    render(LookupSelect, {
      props: {
        'fetch': fetchOptions,
        'modelValue': selectedId,
        'recentKey': 'worker-crews',
        'placeholder': '检索班组',
        'onUpdate:modelValue': onUpdate,
      },
    })
    const input = screen.getByRole<HTMLInputElement>('combobox', { name: '检索班组' })
    expect(input.value).toBe(selectedId ? '班组旧名称' : '')
    await fireEvent.focus(input)
    await fireEvent.update(input, '班组现行名称')
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    await nextTick()
    expect(fetchOptions).toHaveBeenCalledWith('班组现行名称')
    expect(onUpdate).not.toHaveBeenCalled()
    const current = screen.getByRole('option', { name: /班组现行名称\s*泥工/ })
    expect(screen.queryByRole('option', { name: /班组旧名称\s*旧工种/ })).toBeNull()
    expect(screen.getByRole('option', { name: /另一近期班组\s*木工/ })).toBeTruthy()
    await fireEvent.click(current)
    expect(input.value).toBe('班组现行名称')
    if (selectedId)
      expect(onUpdate.mock.calls.every(([id]) => id === 'crew-existing')).toBe(true)
    else
      expect(onUpdate).toHaveBeenCalledWith('crew-existing')
    await vi.advanceTimersByTimeAsync(0)
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual([
      { id: 'crew-existing', label: '班组现行名称', hint: '泥工' },
      { id: 'crew-unmatched', label: '另一近期班组', hint: '木工' },
    ])
  })

  it('撤销当前选择来源后迟到同 ID 更名不能重写近期、输入或稳定选择', async () => {
    vi.useFakeTimers()
    const storageKey = 'kit-lookup:workspace-default:real:worker-crews:recent'
    localStorage.setItem(storageKey, JSON.stringify([{ id: 'crew-existing', label: '原可见班组' }]))
    let resolveOptions!: (options: Array<{ id: string, label: string }>) => void
    const fetchOptions = vi.fn(() => new Promise<Array<{ id: string, label: string }>>((resolve) => {
      resolveOptions = resolve
    }))
    const onUpdate = vi.fn()
    const { rerender } = render(LookupSelect, {
      props: {
        'fetch': fetchOptions,
        'modelValue': 'crew-existing',
        'recentKey': 'worker-crews',
        'placeholder': '检索班组',
        'onUpdate:modelValue': onUpdate,
      },
    })
    const input = screen.getByRole<HTMLInputElement>('combobox', { name: '检索班组' })
    await fireEvent.focus(input)
    await fireEvent.update(input, '核对更名')
    await vi.advanceTimersByTimeAsync(300)
    expect(fetchOptions).toHaveBeenCalledOnce()
    await rerender({ disabledReason: '当前班组来源已无读取权限' })
    resolveOptions([{ id: 'crew-existing', label: '迟到旧权限更名' }])
    await flushPromises()
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
    expect(input.disabled).toBe(true)
    expect(input.value).toBe('')
    expect(screen.queryByRole('option', { name: '迟到旧权限更名' })).toBeNull()
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual([])
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('最近选择使用 Pinia 已授权的工作区而不重读原始偏好', async () => {
    localStorage.setItem('ruihang:workspace-default:include-demo', 'true')
    const visibility = useDataVisibilityStore()
    await visibility.initialize(vi.fn().mockResolvedValue(true))
    localStorage.setItem('ruihang:workspace-default:include-demo', 'false')
    localStorage.setItem('kit-lookup:workspace-default:demo:projects:recent', JSON.stringify([
      { id: 'project-1', label: '演示工作区项目' },
    ]))
    localStorage.setItem('kit-lookup:workspace-default:real:projects:recent', JSON.stringify([
      { id: 'project-1', label: '正式工作区项目' },
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
      .toBe('演示工作区项目')
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
