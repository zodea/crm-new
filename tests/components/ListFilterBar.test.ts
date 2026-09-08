import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import ListFilterBar from '~/components/shared/ListFilterBar.vue'
import SearchInput from '~/components/ui/SearchInput.vue'

describe('列表筛选栏', () => {
  it.each([false, true])('嵌入模式=%s 时搜索和筛选仍向页面回传受控值', async (embedded) => {
    const { emitted } = render(ListFilterBar, {
      props: {
        embedded,
        query: '',
        total: 8,
        filtered: 3,
        filters: [{ key: 'status', label: '状态', value: '', options: [{ label: '草稿', value: 'draft' }] }],
      },
      global: { components: { SearchInput } },
    })

    await fireEvent.update(screen.getByRole('searchbox', { name: '搜索…' }), '合同一')
    await fireEvent.update(screen.getByRole('combobox', { name: '状态' }), 'draft')

    expect(emitted()['update:query']).toEqual([['合同一']])
    expect(emitted().filterChange).toEqual([['status', 'draft']])
    expect(screen.getByRole('region', { name: '列表筛选' }).textContent).toContain('共 8 条')
  })

  it('嵌入模式将标题、搜索和业务操作呈现在同一工具区，缺省筛选不产生空控件', async () => {
    const { emitted } = render(ListFilterBar, {
      props: { embedded: true, query: '已有条件', total: 0, filtered: 0 },
      slots: {
        heading: '<h1>材料到货</h1>',
        actions: '<button type="button">刷新</button><button type="button">新建材料到货</button>',
      },
      global: { components: { SearchInput } },
    })

    expect(screen.getByRole('heading', { name: '材料到货' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '刷新' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '新建材料到货' })).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
    await fireEvent.update(screen.getByRole('searchbox'), '')
    expect(emitted()['update:query']).toEqual([['']])
  })
})
