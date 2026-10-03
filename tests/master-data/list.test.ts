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
  function createMasterDataFilterQuery() {
    const query = { search: '', sort: 'updated-desc' as const, values: { trade: ['泥水工', '油漆工'], status: [] as string[] } }
    return { query }
  }

  it('同字段多选取并集，字段间取交集，清空恢复全集', () => {
    const { query } = createMasterDataFilterQuery()
    query.values.status = ['submitted']
    expect(filterAndSortMasterDataRows(workers, MASTER_DATA_LIST_PROFILES.worker, query).map(row => row.id)).toEqual(['worker-1'])
    query.values.status = []
    query.values.trade = []
  })

  it.each([
    { case: 'workers / MASTER_DATA_LIST_PROFILES.worker / query', prepare: ({ query }: ReturnType<typeof createMasterDataFilterQuery>) => {
      return { input: workers, argument2: MASTER_DATA_LIST_PROFILES.worker, argument3: query, expected: 2 } as const
    } },
    { case: 'workers / MASTER_DATA_LIST_PROFILES.worker / query', prepare: ({ query }: ReturnType<typeof createMasterDataFilterQuery>) => {
      query.values.status = ['submitted']
      query.values.status = []
      query.values.trade = []
      return { input: workers, argument2: MASTER_DATA_LIST_PROFILES.worker, argument3: query, expected: 2 } as const
    } },
  ])('同字段多选取并集，字段间取交集，清空恢复全集 / filterAndSortMasterDataRows：$case', ({ prepare }) => {
    const fixture = createMasterDataFilterQuery()
    const { input, argument2, argument3, expected } = prepare(fixture)
    expect(filterAndSortMasterDataRows(input, argument2, argument3)).toHaveLength(expected)
  })
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

  it.each([
    { case: 'workers / \'crewName\'', input: workers, argument2: 'crewName', expected: [
      { key: '泥水A班', label: '泥水A班' },
      { key: '油漆班', label: '油漆班' },
    ] },
    { case: 'workers / \'status\'', input: workers, argument2: 'status', expected: [
      { key: 'draft', label: '草稿' },
      { key: 'submitted', label: '已提交' },
    ] },
  ])('从真实行生成去重且稳定排序的筛选项 / masterDataFilterOptions：$case', ({ input, argument2, expected }) => {
    expect(masterDataFilterOptions(input, argument2)).toEqual(expected)
  })
})
