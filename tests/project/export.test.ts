import type { Project } from '~/stores/project'
import { describe, expect, it } from 'vitest'
import { PROJECT_EXPORT_COLUMNS, projectLedgerRows } from '~/lib/project/export'

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: '合和新城',
    contractName: '合和新城施工合同',
    code: 'HHXC',
    address: '广州市天河区',
    region: '广州·天河',
    type: '',
    area: null,
    contractAmount: 3238.84,
    overview: '',
    operationType: '自营',
    startDate: '2025-09-15',
    plannedEnd: '2027-03-15',
    actualEnd: '',
    plannedDuration: 546,
    status: '施工中',
    developer: '合和置业',
    developer2: '',
    supervisor: '',
    designer: '',
    contractor: '瑞航建筑',
    manager: '陈志强',
    managerPhone: '',
    execManager: '林伟东',
    builder: '赵工',
    siteLeader: '',
    siteLeaderPhone: '',
    riskLevel: '中',
    approvalStatus: '',
    acceptanceDate: '',
    filingDate: '',
    note: '',
    description: '',
    source: 'manual',
    createdBy: '',
    createdAt: '',
    updatedBy: '',
    updatedAt: '',
    ...overrides,
  }
}

describe('项目台账导出行', () => {
  it('每个项目产出一行，键为中文表头，含执行经理/施工员红圈列', () => {
    const [row] = projectLedgerRows([makeProject()])
    expect(row['项目名称']).toBe('合和新城')
    expect(row['业务流程阶段']).toBe('施工中')
    expect(row['执行经理']).toBe('林伟东')
    expect(row['施工员']).toBe('赵工')
    expect(row['合同金额（万元）']).toBe(3238.84)
  })

  it('空数值列（如未填实际竣工/工期）导出空串，不出现 null 文本', () => {
    const [row] = projectLedgerRows([makeProject({ actualEnd: '', plannedDuration: null })])
    expect(row['实际竣工']).toBe('')
    expect(row['计划工期（天）']).toBe('')
  })

  it('列数与列定义一致，行数与项目数一致', () => {
    const rows = projectLedgerRows([makeProject(), makeProject({ id: 'p2' })])
    expect(rows).toHaveLength(2)
    expect(Object.keys(rows[0]!)).toHaveLength(PROJECT_EXPORT_COLUMNS.length)
  })
})
