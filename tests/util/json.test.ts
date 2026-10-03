// 共享 JSON 文本列解析(#60 review 修复 c14):语法非法与「合法 JSON 但类型错」的脏数据都必须回退缺省值。
// 此前 store 内联版只 try/catch 语法错误,'null'/'0'/'"x"' 穿透后 items=null 会让校对面板模板崩溃。
import { describe, expect, it } from 'vitest'
import { parseJsonColumn } from '~/lib/util/json'

describe('parseJsonColumn:JSON 列安全解析(类型守卫)', () => {
  it.each([
    { case: '\'[1,2]\' / [] as number[]', input: '[1,2]', argument2: [] as number[], expected: [1, 2] },
    { case: '\'{"a":0.9}\' / {} as Record<string, number>', input: '{"a":0.9}', argument2: {} as Record<string, number>, expected: { a: 0.9 } },
  ])('正常载荷:数组列/对象列按原值返回 / parseJsonColumn：$case', ({ input, argument2, expected }) => {
    expect(parseJsonColumn(input, argument2)).toEqual(expected)
  })

  it.each([
    { case: '\'not-json\' / []', input: 'not-json', argument2: [], expected: [] },
    { case: '\'\' / { x: 1 }', input: '', argument2: { x: 1 }, expected: { x: 1 } },
    { case: 'null / []', input: null, argument2: [], expected: [] },
    { case: 'undefined / {}', input: undefined, argument2: {}, expected: {} },
  ])('语法非法/空值:回退缺省 / parseJsonColumn：$case', ({ input, argument2, expected }) => {
    expect(parseJsonColumn(input, argument2)).toEqual(expected)
  })

  it.each([
    { case: '\'null\' / []', input: 'null', argument2: [], expected: [] },
    { case: '\'0\' / []', input: '0', argument2: [], expected: [] },
    { case: '\'"x"\' / []', input: '"x"', argument2: [], expected: [] },
    { case: '\'{}\' / []', input: '{}', argument2: [], expected: [] },
    { case: '\'null\' / { a: 1 }', input: 'null', argument2: { a: 1 }, expected: { a: 1 } },
    { case: '\'[1]\' / { a: 1 }', input: '[1]', argument2: { a: 1 }, expected: { a: 1 } },
  ])('合法 JSON 但类型错(此前穿透导致模板崩溃):一律回退缺省 / parseJsonColumn：$case', ({ input, argument2, expected }) => {
    expect(parseJsonColumn(input, argument2)).toEqual(expected)
  })
})
