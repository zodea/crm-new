import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import SearchInput from '~/components/ui/SearchInput.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import SegTab from '~/components/ui/SegTab.vue'
import SelectFilter from '~/components/ui/SelectFilter.vue'
import TablePager from '~/components/ui/TablePager.vue'

describe('ui atom public contracts', () => {
  it('renders section labels already supplied through props or the default slot', () => {
    const { unmount } = render(SectionHeader, {
      props: {
        title: '基本信息',
        subtitle: '保持字段顺序',
      },
    })

    expect(screen.getByText('基本信息')).not.toBeNull()
    expect(screen.getByText('保持字段顺序')).not.toBeNull()
    unmount()

    render(SectionHeader, {
      slots: {
        default: '项目经营数据',
      },
    })
    expect(screen.getByText('项目经营数据')).not.toBeNull()
  })

  it('keeps SearchInput width on its responsive wrapper', async () => {
    const onUpdate = vi.fn()
    const { container } = render(SearchInput, {
      props: {
        'modelValue': '',
        'placeholder': '搜索项目',
        'width': 280,
        'class': 'w-72',
        'onUpdate:modelValue': onUpdate,
      },
    })

    const root = container.firstElementChild as HTMLElement
    const input = screen.getByRole('searchbox', { name: '搜索项目' })
    expect(root.getAttribute('style')).toContain('width: 280px')
    expect(root.classList).toContain('max-w-full')
    expect(input.getAttribute('style')).toBeNull()
    expect(input.classList).toContain('w-full')

    await fireEvent.update(input, '滨江')
    expect(onUpdate).toHaveBeenLastCalledWith('滨江')
    expect((await axe(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    })).violations).toEqual([])
  })

  it('exposes SegTab selection and count through tab semantics', async () => {
    const onUpdate = vi.fn()
    const { container } = render(SegTab, {
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

    await fireEvent.mouseDown(screen.getByRole('tab', { name: '待处理 3' }), {
      button: 0,
      ctrlKey: false,
    })
    expect(onUpdate).toHaveBeenLastCalledWith('pending')
    expect((await axe(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    })).violations).toEqual([])
  })

  it('exposes SelectFilter options through an accessible popup contract', async () => {
    const { container } = render(SelectFilter, {
      props: {
        modelValue: '',
        label: '状态',
        options: [
          { key: 'all', label: '全部' },
          { key: 'pending', label: '待处理' },
        ],
      },
    })

    await fireEvent.pointerDown(screen.getByRole('combobox', { name: '状态' }), {
      button: 0,
      ctrlKey: false,
    })
    expect(await screen.findByRole('option', { name: '待处理' })).not.toBeNull()
    expect((await axe(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    })).violations).toEqual([])
    expect((await axe(screen.getByRole('listbox'), {
      rules: {
        'color-contrast': { enabled: false },
      },
    })).violations).toEqual([])
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
