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

  it('keeps identical names and colon characters irrelevant to lookup', () => {
    const tradeKey = boqCatalogScopeKey('trade', ['line:b'])
    const itemKey = boqCatalogScopeKey('item', ['line:b'])

    expect(tradeKey).not.toBe(itemKey)
    expect(boqCatalogScopeLineIds(tradeKey, catalog)).toEqual(new Set(['line:b']))
    expect(boqCatalogScopeLineIds('section:["missing"]', catalog)).toEqual(new Set())
  })
})
