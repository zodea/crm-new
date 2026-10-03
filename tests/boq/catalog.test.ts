import { describe, expect, it } from 'vitest'
import {
  boqCatalogScopeKey,
  boqCatalogScopeLineIds,
} from '~/lib/boq/catalog'

describe('boq catalog scope keys', () => {
  const catalog = [{
    name: '分部:同名',
    lineIds: ['line:b', 'line:a'],
    trades: [{
      name: '工种:同名',
      lineIds: ['line:b'],
      items: [{
        name: '重复名称',
        lineIds: ['line:b'],
      }],
    }],
  }]

  it('uses stable typed line-id scopes instead of display-name protocols', () => {
    const key = boqCatalogScopeKey('section', ['line:b', 'line:a'])

    expect(key).toBe('section:["line:a","line:b"]')
    expect(boqCatalogScopeKey('section', ['line:a', 'line:b'])).toBe(key)
    expect(boqCatalogScopeLineIds(key, catalog)).toEqual(new Set(['line:b', 'line:a']))
  })

  describe('keeps identical names and colon characters irrelevant to lookup', () => {
    const tradeKey = boqCatalogScopeKey('trade', ['line:b'])
    const itemKey = boqCatalogScopeKey('item', ['line:b'])
    it('关联事实保持原契约', () => {
      expect(tradeKey).not.toBe(itemKey)
    })

    it.each([
      { case: 'tradeKey / catalog', input: tradeKey, argument2: catalog, expected: new Set(['line:b']) },
      { case: '\'section:["missing"]\' / catalog', input: 'section:["missing"]', argument2: catalog, expected: new Set() },
    ])('boqCatalogScopeLineIds：$case', ({ input, argument2, expected }) => {
      expect(boqCatalogScopeLineIds(structuredClone(input), structuredClone(argument2))).toEqual(expected)
    })
  })
})
