import type { CrewSourceRow, WorkerSourceRow } from '~/lib/crew-worker/read-contract'
import { describe, expect, it } from 'vitest'
import { serializeCrewListQuery, serializeWorkerListQuery } from '~/lib/crew-worker/read-decoder'
import { buildCrewListPage, buildWorkerListPage, parseCrewListQuery, parseWorkerListQuery } from '~/lib/crew-worker/read-page'

const asOf = '2026-09-08T00:00:00.000Z'
const crews: CrewSourceRow[] = Array.from({ length: 6 }, (_, index) => ({
  dataOrigin: 'real',
  id: `crew-${index}`,
  name: `班组${index}`,
  trade: ['木工', '泥工', '电工'][index % 3]!,
  tradeCapabilities: [],
  itemCapabilities: [],
  contactName: '',
  contactPhone: '',
  defaultPayRatio: 1,
  rentSubsidyEnabled: false,
  rentSubsidyPrice: null,
  mgmtFeeEnabled: false,
  mgmtFeePrice: null,
  assignmentLevel: 'crew',
  note: '',
  status: index < 3 ? 'active' : 'inactive',
  updatedAt: asOf,
}))
const workers: WorkerSourceRow[] = crews.map((crew, index) => ({
  dataOrigin: 'real',
  id: `worker-${index}`,
  name: `工人${index}`,
  crewId: crew.id,
  currentProjectId: null,
  trade: crew.trade,
  phone: '',
  idCard: '',
  projectStatus: index < 3 ? '在场' : '已退场',
  status: crew.status,
  entryDate: null,
  exitDate: null,
  safetyEducation: false,
  updatedAt: asOf,
}))

describe('班组工人多选查询', () => {
  it('班组工种取并集、状态取交集，facet保留其他候选且无测试来源', () => {
    const query = parseCrewListQuery({ trade: ['木工', '泥工'], status: 'active', page: 999 })
    expect(parseCrewListQuery(serializeCrewListQuery(query))).toEqual(query)
    const page = buildCrewListPage({ crews: [...crews, { ...crews[0]!, id: 'hidden', dataOrigin: 'demo', trade: '隐藏工种' }], workers, assignments: [], wages: [], query, asOf, sourceVersion: 'multi', capabilities: [] })
    expect(page.pagination).toEqual({ page: 1, pageSize: 10, total: 2 })
    expect(page.summary.trades.map(item => item.value)).toEqual(['电工', '木工', '泥工'])
    expect(page.summary.statuses).toEqual([{ value: 'active', label: 'active', count: 2 }, { value: 'inactive', label: 'inactive', count: 2 }])
  })
  it('工人三组固定值支持多选且兼容旧标量，项目状态facet不被自身收窄', () => {
    const query = parseWorkerListQuery({ trade: '["木工","泥工"]', status: ['active', 'inactive'], projectStatus: ['在场'], page: 999 })
    expect(parseWorkerListQuery(serializeWorkerListQuery(query))).toEqual(query)
    const input = { workers, crews, projects: [], query, asOf, sourceVersion: 'multi', capabilities: [] }
    const page = buildWorkerListPage(input)
    expect(page.pagination).toEqual({ page: 1, pageSize: 10, total: 2 })
    expect(page.summary.projectStatuses).toHaveLength(2)
    expect(buildWorkerListPage({ ...input, query: { ...query, trade: [], status: [], projectStatus: [] } }).pagination.total).toBe(6)
    expect(buildWorkerListPage({ ...input, query: { ...query, trade: '电工', status: 'active' } }).items).toHaveLength(1)
    expect(() => parseWorkerListQuery({ projectStatus: [false] })).toThrow()
  })
})
