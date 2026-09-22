import { describe, expect, it } from 'vitest'
import { matchProjectText, matchSupplierName } from '~/lib/delivery/match'

describe('matchSupplierName', () => {
  const suppliers = [
    { id: 's1', name: '广州市兴裕丰装饰材料有限公司', aliases: ['兴裕丰材料'] },
    { id: 's2', name: '佛山市大板东建材有限公司', aliases: [] },
  ]

  it('忽略 OCR 空格、单据类型尾缀和公司法律后缀完成精确归一', () => {
    expect(matchSupplierName('广州市 兴裕丰装饰材料有限公司销售单', suppliers)).toMatchObject({
      id: 's1',
      name: '广州市兴裕丰装饰材料有限公司',
      kind: 'exact',
      score: 1,
    })
  })

  it('别名或少量 OCR 错字可给出唯一模糊候选', () => {
    expect(matchSupplierName('兴裕丰材料', suppliers)).toMatchObject({ id: 's1', kind: 'exact' })
    expect(matchSupplierName('广州市兴裕丰装饰材科有限公可', suppliers)).toMatchObject({
      id: 's1',
      kind: 'fuzzy',
    })
  })

  it('低分或同分歧义时留给人工选择，不武断绑定主数据', () => {
    const ambiguous = [
      { id: 'a', name: '广州宏达建材有限公司', aliases: [] },
      { id: 'b', name: '广州宏达建材经营部', aliases: [] },
    ]
    expect(matchSupplierName('广州宏达建材', ambiguous)).toBeNull()
    expect(matchSupplierName('完全无关抬头', suppliers)).toBeNull()
  })
})

describe('matchProjectText', () => {
  it('同名项目或同长命中不能按数组顺序误选稳定身份', () => {
    expect(matchProjectText(['中央项目送货'], [{ id: 'a', name: '中央项目' }, { id: 'b', name: '中央项目' }])).toBeNull()
    expect(matchProjectText(['北门东区'], [{ id: 'a', name: '项目甲', aliases: ['北门'] }, { id: 'b', name: '项目乙', aliases: ['东区'] }])).toBeNull()
  })
  it('从工地原文或文件名中预选项目，多个命中时取更具体的长名称', () => {
    const projects = [
      { id: 'p1', name: '合和新城' },
      { id: 'p2', name: '合和新城更衣室装修工程' },
    ]
    expect(matchProjectText(['送货地址：合和新城更衣室装修工程项目部', '送货单.pdf'], projects)).toEqual({
      id: 'p2',
      name: '合和新城更衣室装修工程',
    })
  })

  it('已人工确认的工地别名可在后续文件中直接命中项目', () => {
    expect(matchProjectText(['收货地点：和新项目北门'], [
      { id: 'p1', name: '合和新城更衣室装修工程', aliases: ['和新项目北门'] },
    ])).toMatchObject({ id: 'p1' })
  })
})
