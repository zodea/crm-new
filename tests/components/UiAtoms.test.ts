import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import SearchInput from '~/components/ui/SearchInput.vue'
import SegTab from '~/components/ui/SegTab.vue'
import SelectFilter from '~/components/ui/SelectFilter.vue'
import TablePager from '~/components/ui/TablePager.vue'

describe('ui atom public contracts', () => {
  it('updates SearchInput through its accessible searchbox contract', async () => {
    const onUpdate = vi.fn()
    render(SearchInput, {
      props: {
        'modelValue': '',
        'placeholder': '搜索项目',
        'width': 280,
        'onUpdate:modelValue': onUpdate,
      },
    })

    const input = screen.getByRole('searchbox', { name: '搜索项目' })
    expect(input.getAttribute('style')).toContain('width: 280px')

    await fireEvent.update(input, '滨江')
    expect(onUpdate).toHaveBeenLastCalledWith('滨江')
  })

  it('exposes SegTab selection and count through tab semantics', async () => {
    const onUpdate = vi.fn()
    render(SegTab, {
      props: {
        'modelValue': 'all',
        'tabs': [
          { key: 'all', label: '全部', count: 12 },
          { key: 'pending', label: '待处理', count: 3 },
        ],
        'onUpdate:modelValue': onUpdate,
      },
    })

    expect(screen.getByRole('tablist')).not.toBeNull()
    expect(screen.getByRole('tab', { name: '全部 12' }).getAttribute('aria-selected')).toBe('true')

    const pendingTab = screen.getByRole('tab', { name: '待处理 3' })
    pendingTab.focus()
    await fireEvent.keyDown(pendingTab, { key: 'Enter' })
    expect(onUpdate).toHaveBeenLastCalledWith('pending')
  })

  it('selects a SelectFilter option from its popup contract', async () => {
    const onUpdate = vi.fn()
    render(SelectFilter, {
      props: {
        'modelValue': '',
        'label': '状态',
        'options': [
          { key: 'all', label: '全部' },
          { key: 'pending', label: '待处理' },
        ],
        'onUpdate:modelValue': onUpdate,
      },
    })

    await fireEvent.pointerDown(screen.getByRole('combobox', { name: '状态' }), {
      button: 0,
      ctrlKey: false,
    })
    const option = await screen.findByRole('option', { name: '待处理' })
    option.focus()
    await fireEvent.keyDown(option, { key: 'Enter' })

    await vi.waitFor(() => {
      expect(onUpdate).toHaveBeenLastCalledWith('pending')
    })
  })

  it('emits bounded page and page-size changes with named controls', async () => {
    const onPage = vi.fn()
    const onPageSize = vi.fn()
    const { container } = render(TablePager, {
      props: {
        'total': 45,
        'page': 2,
        'pageSize': 20,
        'pageSizeOptions': [20, 50],
        'onUpdate:page': onPage,
        'onUpdate:pageSize': onPageSize,
      },
    })

    expect(screen.getByRole('button', { name: '第 2 页' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: '下一页' }).getAttribute('type')).toBe('button')

    await fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    expect(onPage).toHaveBeenLastCalledWith(1)
    await fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(onPage).toHaveBeenLastCalledWith(3)

    await fireEvent.update(screen.getByRole('combobox', { name: '每页条数' }), '50')
    expect(onPageSize).toHaveBeenLastCalledWith(50)
    expect((await axe(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    })).violations).toEqual([])
  })
})
