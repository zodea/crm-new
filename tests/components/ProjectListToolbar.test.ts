import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import ProjectListToolbar from '~/components/project/ProjectListToolbar.vue'

const SearchInputStub = defineComponent({
  props: {
    modelValue: String,
    placeholder: String,
    maxlength: Number,
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('input', {
      'aria-label': props.placeholder,
      'type': 'search',
      'value': props.modelValue,
      'maxlength': props.maxlength,
      'onInput': (event: Event) =>
        emit('update:modelValue', (event.target as HTMLInputElement).value),
    })
  },
})

const global = {
  components: {
    SearchInput: SearchInputStub,
  },
}

describe('project list toolbar', () => {
  const props = {
    search: '',
    realTotal: 12,
    demoTotal: 0,
    includeDemo: false,
    visible: 7,
    loading: false,
    sortMode: 'updated-desc' as const,
    filtersVisible: true,
    density: 'compact' as const,
  }

  it('以单行可滚动工具带保留参考操作和本地新建能力', () => {
    render(ProjectListToolbar, { props, global })

    expect(screen.getByRole('heading', { name: '施工项目' })).not.toBeNull()
    expect(screen.getByRole('searchbox', { name: '搜索项目、客户、经理…' })).not.toBeNull()
    expect((screen.getByRole('searchbox', { name: '搜索项目、客户、经理…' }) as HTMLInputElement).maxLength).toBe(120)
    expect(screen.getByRole('button', { name: '刷新项目列表' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '切换项目排序' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '显示或隐藏阶段筛选' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '切换表格密度' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '导入项目' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '新增项目' })).not.toBeNull()
    expect(screen.getByTestId('project-list-toolbar-scroll').className).toContain('overflow-x-auto')
  })

  it('通过公开事件传递搜索、刷新、排序、筛选、设置、导入和导出操作', async () => {
    const view = render(ProjectListToolbar, { props, global })

    await fireEvent.update(screen.getByRole('searchbox', { name: '搜索项目、客户、经理…' }), '合和')
    await fireEvent.click(screen.getByRole('button', { name: '刷新项目列表' }))
    await fireEvent.click(screen.getByRole('button', { name: '切换项目排序' }))
    await fireEvent.click(screen.getByRole('button', { name: '显示或隐藏阶段筛选' }))
    await fireEvent.click(screen.getByRole('button', { name: '切换表格密度' }))
    await fireEvent.click(screen.getByRole('button', { name: '导入项目' }))
    await fireEvent.click(screen.getByRole('button', { name: '新增项目' }))
    await fireEvent.click(screen.getByRole('button', { name: '导出台账' }))
    await fireEvent.click(screen.getByRole('button', { name: '分类导出' }))

    expect(view.emitted()['update:search']).toEqual([['合和']])
    expect(view.emitted().refresh).toHaveLength(1)
    expect(view.emitted()['update:sortMode']).toEqual([['name-asc']])
    expect(view.emitted()['update:filtersVisible']).toEqual([[false]])
    expect(view.emitted()['update:density']).toEqual([['comfortable']])
    expect(view.emitted().import).toHaveLength(1)
    expect(view.emitted().create).toHaveLength(1)
    expect(view.emitted().exportLedger).toHaveLength(1)
    expect(view.emitted().exportByCategory).toHaveLength(1)
  })

  it('新增接入中央命令后保持可用，未迁移的导入仍明确禁用', () => {
    const reason = '项目导入尚未接入中央后台'
    render(ProjectListToolbar, {
      props: { ...props, importDisabledReason: reason },
      global,
    })

    const importButton = screen.getByRole('button', { name: '导入项目' }) as HTMLButtonElement
    const createButton = screen.getByRole('button', { name: '新增项目' }) as HTMLButtonElement
    expect(importButton.disabled).toBe(true)
    expect(importButton.getAttribute('title')).toBe(reason)
    expect(createButton.disabled).toBe(false)
  })

  it('无项目写入权限时单独禁用新增', () => {
    render(ProjectListToolbar, {
      props: { ...props, createDisabledReason: '无项目写入权限' },
      global,
    })
    const button = screen.getByRole('button', { name: '新增项目' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toBe('无项目写入权限')
  })
})
