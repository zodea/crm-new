import { describe, expect, it } from 'vitest'
import { isMetricDTO } from '~/lib/read-model/metric'

const metric = { value: '0.00', knownValue: '0.00', unit: 'CNY', quantityUnit: null, status: 'complete', missingSources: [], participatingCount: 2, missingCount: 0, asOf: '2026-10-04T08:00:00.000Z', drilldown: { kind: 'entity-list', entity: 'receipt', variant: null, view: null, filters: { projectId: 'project-a', dataOrigin: 'real' } } }
describe('指标独立完整度与已知小计', () => {
  it('已知零、全部未知与部分可证小计有不同结果，部分值不能冒充完整额', () => {
    expect(isMetricDTO(metric)).toBe(true)
    expect(isMetricDTO({ ...metric, value: null, knownValue: null, status: 'pending', participatingCount: null, missingCount: null, missingSources: ['source-unavailable'], drilldown: null })).toBe(true)
    expect(isMetricDTO({ ...metric, value: null, knownValue: '12.50', status: 'partial', missingCount: 1, missingSources: ['missing-amount'] })).toBe(true)
    expect(isMetricDTO({ ...metric, value: '12.50', knownValue: '12.50', status: 'partial', missingCount: 1, missingSources: ['missing-amount'] })).toBe(false)
    expect(isMetricDTO({ ...metric, knownValue: null })).toBe(false)
  })
  it('数量缺单位、比例部分值、负计数与非法导航不能进入可信指标', () => {
    expect(isMetricDTO({ ...metric, unit: 'quantity', value: '2.125', knownValue: '2.125', quantityUnit: 'm³' })).toBe(true)
    expect(isMetricDTO({ ...metric, unit: 'quantity', value: '2.125', knownValue: '2.125' })).toBe(false)
    expect(isMetricDTO({ ...metric, unit: 'ratio', value: null, knownValue: '0.25', status: 'partial', missingSources: ['denominator'] })).toBe(false)
    expect(isMetricDTO({ ...metric, participatingCount: -1 })).toBe(false)
    expect(isMetricDTO({ ...metric, drilldown: { entity: 'receipt', filters: { projectId: 'project-a' } } })).toBe(false)
    expect(isMetricDTO({ ...metric, drilldown: { kind: 'unavailable', reason: 'forbidden', projectId: 'hidden' } })).toBe(false)
  })
})
