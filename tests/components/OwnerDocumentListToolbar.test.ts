import { render, screen } from '@testing-library/vue'
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
})
