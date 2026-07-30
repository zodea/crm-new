import type { WorkerDetail } from '~/lib/worker/detail'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import WorkerDetailLaborFacts from '~/components/worker/WorkerDetailLaborFacts.vue'
import WorkerDetailProfile from '~/components/worker/WorkerDetailProfile.vue'

const NuxtLink = defineComponent({
  props: ['to'],
  template: '<a :href="to"><slot /></a>',
})

const SectionHeader = defineComponent({
  props: ['title', 'subtitle'],
  template: '<header><h2>{{ title }}</h2><p>{{ subtitle }}</p></header>',
})

const KitTable = defineComponent({
  props: {
    columns: {
      type: Array,
      default: () => [],
    },
    data: {
      type: Array,
      default: () => [],
    },
    empty: {
      type: Object,
      default: () => ({ title: '暂无数据' }),
    },
  },
  setup(props, { slots }) {
    return () => h('div', props.data.length
      ? (props.data as Record<string, unknown>[]).map(row =>
          h('div', (props.columns as { field?: string, slot?: string }[]).map((column) => {
            if (column.slot && slots[column.slot])
              return slots[column.slot]?.({ row })
            return h('span', column.field ? String(row[column.field] ?? '—') : '')
          })))
      : h('p', String((props.empty as { title: string }).title)))
  },
})

const global = {
  components: {
    KitTable,
    NuxtLink,
    SectionHeader,
  },
}

function detailFixture(): WorkerDetail {
  return {
    worker: {
      id: 'worker-a',
      name: '王师傅',
      gender: '男',
      idCard: '440101199001010011',
      phone: '13800000002',
      hometown: '广东广州',
      emergencyContact: '王家属',
      emergencyPhone: '13800000003',
      trade: '泥水工',
      skillLevel: '高级',
      dailyWage: 380,
      projectStatus: '在场',
      entryDate: '2026-05-01',
      exitDate: '',
      safetyEducation: true,
      note: '',
      bankName: '建设银行',
      bankAccount: '6227000000000000',
      bankCode: 'CCB',
      status: 'submitted',
    },
    crew: {
      id: 'crew-a',
      name: '泥水A班',
      trade: '泥水工',
      contactName: '虞建华',
      contactPhone: '13800000001',
    },
    capabilities: {
      trades: ['泥水工'],
      itemNames: ['墙砖铺贴'],
    },
    relatedWorkers: [],
    attachments: [],
    projects: [],
    assignments: [],
    attendance: [],
    daywork: [],
    wageStatements: [],
    penalties: [],
    summary: {
      projectCount: 0,
      assignedUnitCount: 0,
      completedStageCount: 0,
      attendanceDays: 0,
      attendanceHours: 0,
      overtimeHours: 0,
      confirmedDayworkUnits: 0,
      releasedStatementCount: 0,
      knownAllocatedAmount: 0,
      missingAllocationCount: 0,
      penaltyAmount: 0,
    },
  }
}

describe('工人详情独立区块', () => {
  it('电话、紧急联系人、身份证和银行卡只展示脱敏值，并拆分档案与在场状态', () => {
    const wrapper = mount(WorkerDetailProfile, {
      props: { detail: detailFixture() },
      global,
    })

    expect(wrapper.text()).toContain('4401 **** 0011')
    expect(wrapper.text()).toContain('138 **** 0002')
    expect(wrapper.text()).toContain('王**')
    expect(wrapper.text()).toContain('138 **** 0003')
    expect(wrapper.text()).toContain('6227 **** 0000')
    expect(wrapper.text()).not.toContain('440101199001010011')
    expect(wrapper.text()).not.toContain('13800000002')
    expect(wrapper.text()).not.toContain('王家属')
    expect(wrapper.text()).not.toContain('13800000003')
    expect(wrapper.text()).not.toContain('6227000000000000')
    expect(wrapper.text()).toContain('档案状态已提交')
    expect(wrapper.text()).toContain('在场状态在场')
  })

  it('工资与项目扣罚都保留真实源单下钻', () => {
    const wrapper = mount(WorkerDetailLaborFacts, {
      props: {
        attendance: [],
        daywork: [],
        wageStatements: [{
          id: 'statement-a',
          projectId: 'project-a',
          projectName: '合和新城',
          month: '2026-06',
          formatFamily: 'A',
          periodKind: 'monthly',
          quantitySource: 'field',
          status: 'released',
          payRatio: 1,
          statementGrossAmount: 1200,
          statementActualAmount: 1200,
          workerLineAmount: 1000,
          allocatedAmount: 800,
          allocationRecorded: true,
          isLeader: true,
          lines: [],
        }],
        penalties: [{
          id: 'penalty-a',
          no: 'FK-001',
          projectId: 'project-a',
          projectName: '合和新城',
          source: 'inspection',
          sourceLabel: '管理巡检',
          location: '1栋 / 2层 / 201户',
          reason: '墙砖空鼓',
          amount: 300,
          penaltyDate: '2026-06-18',
          status: 'pending',
          statusLabel: '待处理',
        }],
      },
      global,
    })

    expect(wrapper.text()).toContain('已发放')
    expect(wrapper.text()).toContain('管理巡检')
    expect(wrapper.findAll('a').map(link => link.attributes('href'))).toEqual([
      '/subcontract/payroll/statement-a',
      '/project/project-a',
      '/project/penalty/penalty-a',
    ])
  })

  it('没有业务事实时不制造工资和扣罚记录', () => {
    const wrapper = mount(WorkerDetailLaborFacts, {
      props: {
        attendance: [],
        daywork: [],
        wageStatements: [],
        penalties: [],
      },
      global,
    })

    expect(wrapper.text()).toContain('暂无工资单关联')
    expect(wrapper.text()).toContain('暂无与该工人直接关联的项目扣罚')
    expect(wrapper.find('a').exists()).toBe(false)
  })
})
