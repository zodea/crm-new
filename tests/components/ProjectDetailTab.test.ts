import { render, screen, within } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import ProjectDetailTab from '~/components/project/ProjectDetailTab.vue'

const project = {
  id: 'project-1',
  name: '车陂商业大楼',
  contractName: '车陂商业大楼室内装饰工程合同',
  code: 'CBSYDL-01',
  address: '广州市天河区',
  region: '华南',
  operationType: '联营',
  startDate: '2024-12-29',
  plannedEnd: '2025-06-15',
  status: '保修',
  developer: '天河城建投资',
  supervisor: '华南监理',
  designer: '瑞航设计',
  contractor: '瑞航装饰',
  manager: '周维',
  managerPhone: '13800000000',
  createdAt: '2025-03-13T14:42:00',
  updatedAt: '2026-08-12T14:07:00',
  note: '重点项目',
} as const

describe('项目详细资料', () => {
  it('用三个语义化资料分区呈现标签和值，不把只读资料伪装成表单', () => {
    render(ProjectDetailTab, { props: { project } })

    for (const title of ['基础信息', '参建单位', '系统信息']) {
      const section = screen.getByRole('group', { name: title })
      expect(section.querySelector('dl')).not.toBeNull()
    }

    const basic = screen.getByRole('group', { name: '基础信息' })
    expect(within(basic).getByText('项目名称')).not.toBeNull()
    expect(within(basic).getByText('车陂商业大楼')).not.toBeNull()
    expect(within(basic).getByText('工程详细地址')).not.toBeNull()
    expect(within(basic).getByText('广州市天河区')).not.toBeNull()
  })
})
