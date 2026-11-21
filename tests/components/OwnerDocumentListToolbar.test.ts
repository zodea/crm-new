import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import OwnerDocumentListToolbar from '~/components/owner-document/OwnerDocumentListToolbar.vue'

const props = {
  title: '甲方变洽签',
  subtitle: '中央正式单据',
  createLabel: '新建甲方变洽签',
  loading: false,
  searchPlaceholder: '搜索',
  showType: false,
  typeLabel: '类型',
  projectOptions: [{ key: 'all', label: '全部项目' }],
  typeOptions: [{ key: 'all', label: '全部类型' }],
  views: [{ key: 'all', label: '全部状态' }],
  search: '',
  project: 'all',
  type: 'all',
  view: 'all',
}

describe('甲方商务单据列表工具栏权限', () => {
  it('中央能力不含写入时不呈现新建入口', () => {
    render(OwnerDocumentListToolbar, { props: { ...props, canCreate: false } })
    expect(screen.queryByRole('button', { name: '新建甲方变洽签' })).toBeNull()
  })

  it('具有写入能力时呈现新建入口', () => {
    render(OwnerDocumentListToolbar, { props: { ...props, canCreate: true } })
    expect(screen.getByRole('button', { name: '新建甲方变洽签' })).not.toBeNull()
  })

  it('用单据名称标记刷新操作，读取期间禁用并显示旋转图标', async () => {
    const view = render(OwnerDocumentListToolbar, { props: { ...props, loading: true } })
    const refresh = screen.getByRole('button', { name: '刷新甲方变洽签' })

    expect(refresh.hasAttribute('disabled')).toBe(true)
    expect(refresh.querySelector('.animate-spin')).not.toBeNull()
    refresh.click()
    expect(view.emitted().refresh).toBeUndefined()

    await view.rerender({ ...props, loading: false })
    expect(refresh.hasAttribute('disabled')).toBe(false)
    expect(refresh.querySelector('.animate-spin')).toBeNull()
    await fireEvent.click(refresh)
    expect(view.emitted().refresh).toHaveLength(1)
  })

  it('解释文字默认收进标题旁的帮助入口', () => {
    render(OwnerDocumentListToolbar, { props: { ...props, subtitle: '同一验收记录的竣工验收与保修到期双视图' } })
    expect(screen.queryByText('同一验收记录的竣工验收与保修到期双视图')).toBeNull()
    expect(screen.getByRole('button', { name: '查看甲方变洽签说明' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '甲方变洽签' })).toBeTruthy()
  })
})
