import { describe, expect, it } from 'vitest'
import {
  filterAndSortMasterDataRows,
  MASTER_DATA_LIST_PROFILES,
  masterDataFilterOptions,
} from '~/lib/master-data/list'

const workers = [
  {
    id: 'worker-1',
    name: '张师傅',
    trade: '泥水工',
    crewName: '泥水A班',
    projectName: '合和新城',
    projectStatus: '在场',
    status: 'submitted',
    idCard: '440101199001011234',
    updatedAt: '2026-07-29T10:00:00.000Z',
  },
  {
    id: 'worker-2',
    name: '李师傅',
    trade: '油漆工',
    crewName: '油漆班',
    projectName: '锦绣华庭',
    projectStatus: '已退场',
    status: 'draft',
    idCard: '440101198802025678',
    updatedAt: '2026-07-30T10:00:00.000Z',
  },
]

describe('主数据列表筛选与排序', () => {
  it('搜索覆盖实体字段并叠加班组和在场状态筛选', () => {
    expect(filterAndSortMasterDataRows(
      workers,
      MASTER_DATA_LIST_PROFILES.worker,
      {
        search: '4401011990',
        sort: 'updated-desc',
        values: {
          trade: 'all',
          crewName: '泥水A班',
          projectName: 'all',
          status: 'all',
          projectStatus: '在场',
          safetyEducationLabel: 'all',
        },
      },
    ).map(row => row.id)).toEqual(['worker-1'])
  })

  it('最近更新稳定排序并支持名称升降序', () => {
    expect(filterAndSortMasterDataRows(
      workers,
      MASTER_DATA_LIST_PROFILES.worker,
      {
        search: '',
        sort: 'updated-desc',
        values: {
          trade: 'all',
          crewName: 'all',
          projectName: 'all',
          status: 'all',
          projectStatus: 'all',
          safetyEducationLabel: 'all',
        },
      },
    ).map(row => row.id)).toEqual(['worker-2', 'worker-1'])

    expect(filterAndSortMasterDataRows(
      workers,
      MASTER_DATA_LIST_PROFILES.worker,
      {
        search: '',
        sort: 'name-asc',
        values: {
          trade: 'all',
          crewName: 'all',
          projectName: 'all',
          status: 'all',
          projectStatus: 'all',
          safetyEducationLabel: 'all',
        },
      },
    ).map(row => row.id)).toEqual(['worker-2', 'worker-1'])
  })

  it('从真实行生成去重且稳定排序的筛选项', () => {
    expect(masterDataFilterOptions(workers, 'crewName')).toEqual([
      { key: '泥水A班', label: '泥水A班' },
      { key: '油漆班', label: '油漆班' },
    ])
    expect(masterDataFilterOptions(workers, 'status')).toEqual([
      { key: 'draft', label: '草稿' },
      { key: 'submitted', label: '已提交' },
    ])
  })
})
