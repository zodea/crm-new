// 共享 JSON 文本列解析(#60 review 修复 c14):语法非法与「合法 JSON 但类型错」的脏数据都必须回退缺省值。
// 此前 store 内联版只 try/catch 语法错误,'null'/'0'/'"x"' 穿透后 items=null 会让校对面板模板崩溃。
import { describe, expect, it } from 'vitest'
import { parseJsonColumn } from '~/lib/util/json'

describe('parseJsonColumn:JSON 列安全解析(类型守卫)', () => {
  it('正常载荷:数组列/对象列按原值返回', () => {
    expect(parseJsonColumn('[1,2]', [] as number[])).toEqual([1, 2])
    expect(parseJsonColumn('{"a":0.9}', {} as Record<string, number>)).toEqual({ a: 0.9 })
  })

  it('语法非法/空值:回退缺省', () => {
    expect(parseJsonColumn('not-json', [])).toEqual([])
    expect(parseJsonColumn('', { x: 1 })).toEqual({ x: 1 })
    expect(parseJsonColumn(null, [])).toEqual([])
    expect(parseJsonColumn(undefined, {})).toEqual({})
  })

  it('合法 JSON 但类型错(此前穿透导致模板崩溃):一律回退缺省', () => {
    expect(parseJsonColumn('null', [])).toEqual([])
    expect(parseJsonColumn('0', [])).toEqual([])
    expect(parseJsonColumn('"x"', [])).toEqual([])
    expect(parseJsonColumn('{}', [])).toEqual([])
    expect(parseJsonColumn('null', { a: 1 })).toEqual({ a: 1 })
    expect(parseJsonColumn('[1]', { a: 1 })).toEqual({ a: 1 })
  })
})
