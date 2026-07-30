import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import CrewDetailMembers from '~/components/master-data/CrewDetailMembers.vue'
import CrewDetailPenalties from '~/components/master-data/CrewDetailPenalties.vue'
import CrewDetailProjects from '~/components/master-data/CrewDetailProjects.vue'

const NuxtLink = defineComponent({
  props: ['to'],
  template: '<a :href="to"><slot /></a>',
})

const SectionHeader = defineComponent({
  props: ['title', 'subtitle'],
  template: '<header><h2>{{ title }}</h2><p>{{ subtitle }}</p></header>',
})

const StatePanel = defineComponent({
  props: ['title', 'description'],
  template: '<div role="status"><strong>{{ title }}</strong><span>{{ description }}</span></div>',
})

const global = {
  components: {
    NuxtLink,
    SectionHeader,
    StatePanel,
  },
}

describe('班组详情关系区块', () => {
  it('成员电话只显示脱敏值，成员、关联人员和当前项目都可真实下钻', () => {
    const wrapper = mount(CrewDetailMembers, {
      props: {
        members: [{
          id: 'worker-a',
          name: '超长姓名测试成员甲',
          trade: '泥水工',
          phone: '13511220001',
          projectStatus: '在场',
          currentProjectId: 'project-a',
          currentProjectName: '超长项目名称测试甲',
          entryDate: '2026-01-02',
          dailyWage: 320,
          linkedWorkerId: 'worker-b',
          linkedWorkerName: '关联人员乙',
        }],
      },
      global,
    })

    expect(wrapper.text()).toContain('135 **** 0001')
    expect(wrapper.text()).not.toContain('13511220001')
    expect(wrapper.findAll('a').map(link => link.attributes('href'))).toEqual([
      '/base/worker/worker-a',
      '/base/worker/worker-b',
      '/project/project-a',
    ])
    expect(wrapper.findAll('a').map(link => link.attributes('title'))).toEqual([
      '超长姓名测试成员甲',
      '关联人员：关联人员乙',
      '超长项目名称测试甲',
    ])
  })

  it('成员、项目和扣罚缺少真实关系时分别展示明确空态', () => {
    const members = mount(CrewDetailMembers, {
      props: { members: [] },
      global,
    })
    const projects = mount(CrewDetailProjects, {
      props: { projects: [] },
      global,
    })
    const penalties = mount(CrewDetailPenalties, {
      props: { penalties: [] },
      global,
    })

    expect(members.get('[role="status"]').text()).toContain('暂无班组成员')
    expect(projects.get('[role="status"]').text()).toContain('暂无项目关联')
    expect(penalties.get('[role="status"]').text()).toContain('暂无扣罚记录')
    expect(members.find('table').exists()).toBe(false)
    expect(projects.find('table').exists()).toBe(false)
    expect(penalties.find('table').exists()).toBe(false)
  })

  it('项目汇总和扣罚记录都保留真实源单入口', () => {
    const project = mount(CrewDetailProjects, {
      props: {
        projects: [{
          projectId: 'project-a',
          projectName: '合和新城',
          projectCode: 'HHXC',
          projectStatus: '施工中',
          sources: ['在场成员', '工程量责任'],
          activeMemberCount: 2,
          assignmentCount: 3,
          assignedUnitCount: 2,
          completedStageCount: 1,
          wageStatementCount: 0,
          wageGrossAmount: 0,
          releasedWageAmount: 0,
        }],
      },
      global,
    })
    const penalty = mount(CrewDetailPenalties, {
      props: {
        penalties: [{
          id: 'penalty-a',
          no: 'FK-001',
          projectId: 'project-a',
          projectName: '合和新城',
          source: 'inspection',
          sourceLabel: '管理巡检',
          location: '1栋',
          reason: '墙砖空鼓',
          amount: 300,
          penaltyDate: '2026-06-18',
          status: 'pending',
          statusLabel: '待处理',
        }],
      },
      global,
    })

    expect(project.get('a').attributes('href')).toBe('/project/project-a')
    expect(penalty.findAll('a').map(link => link.attributes('href'))).toEqual([
      '/project/project-a',
      '/project/penalty/penalty-a',
    ])
  })
})
