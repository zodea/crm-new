import { describe, expect, it } from 'vitest'
import { filterProjectColumns, filterProjects } from '~/lib/project/list'

const rows = [
  {
    id: 'p1',
    name: '合和新城',
    code: 'HHXC-01',
    address: '广州市白云区',
    contractName: '合和新城施工合同',
    developer: '合和地产集团',
    manager: '张工',
    status: '施工中',
  },
  {
    id: 'p2',
    name: '江湾一号',
    code: 'JW-01',
    address: '广州市海珠区',
    contractName: '',
    developer: '江湾置业',
    manager: '陈工',
    status: '停工',
  },
]

describe('项目列表筛选', () => {
  it('all 不限制状态，关键词为空返回全量', () => {
    expect(filterProjects(rows, { search: '', status: 'all' })).toEqual(rows)
  })

  it.each([
    { case: 'rows / { search: \'江湾\', status: \'停工\' }', input: rows, argument2: { search: '江湾', status: '停工' }, expected: [rows[1]] },
    { case: 'rows / { search: \'江湾\', status: \'施工中\' }', input: rows, argument2: { search: '江湾', status: '施工中' }, expected: [] },
  ])('状态与关键词组合过滤 / filterProjects：$case', ({ input, argument2, expected }) => {
    expect(filterProjects(input, argument2)).toEqual(expected)
  })

  it.each([
    { case: 'rows / { search: \' hhxc \', status: \'all\' }', input: rows, argument2: { search: ' hhxc ', status: 'all' }, expected: [rows[0]] },
    { case: 'rows / { search: \'白云\', status: \'all\' }', input: rows, argument2: { search: '白云', status: 'all' }, expected: [rows[0]] },
    { case: 'rows / { search: \'施工合同\', status: \'all\' }', input: rows, argument2: { search: '施工合同', status: 'all' }, expected: [rows[0]] },
    { case: 'rows / { search: \'陈工\', status: \'all\' }', input: rows, argument2: { search: '陈工', status: 'all' }, expected: [rows[1]] },
  ])('关键词覆盖名称、编号、地址、合同名、客户与经理且忽略大小写和首尾空格 / filterProjects：$case', ({ input, argument2, expected }) => {
    expect(filterProjects(input, argument2)).toEqual(expected)
  })

  it.each([
    { case: 'rows / [ { field: \'status\', values: [\'施工中\'] }, { field: \'manager\', values: [\'张工\'] }, ]', input: rows, argument2: [
      { field: 'status', values: ['施工中'] },
      { field: 'manager', values: ['张工'] },
    ], expected: [rows[0]] },
    { case: 'rows / [{ field: \'status\', values: [] }]', input: rows, argument2: [{ field: 'status', values: [] }], expected: rows },
  ])('列头筛选按多个字段取交集，空选项不限制 / filterProjectColumns：$case', ({ input, argument2, expected }) => {
    expect(filterProjectColumns(input, argument2)).toEqual(expected)
  })
})
