import type { MetricDTO } from '../../types/read-model'
import { isISODateTimeDTO, isNavigationIntentDTO } from '../../types/read-model'

export function isMetricDTO(value: unknown): value is MetricDTO {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  const metric = value as Record<string, unknown>
  if (Object.keys(metric).length !== 10 || !['value', 'knownValue', 'unit', 'quantityUnit', 'status', 'missingSources', 'participatingCount', 'missingCount', 'asOf', 'drilldown'].every(key => Object.hasOwn(metric, key))
    || !['CNY', 'quantity', 'ratio', 'count'].includes(String(metric.unit))
    || !['complete', 'partial', 'pending', 'not-applicable', 'undefined'].includes(String(metric.status))
    || !Array.isArray(metric.missingSources) || !metric.missingSources.every(source => typeof source === 'string' && !!source)
    || ![metric.participatingCount, metric.missingCount].every(count => count === null || (Number.isSafeInteger(count) && Number(count) >= 0))
    || !isISODateTimeDTO(metric.asOf) || !(metric.drilldown === null || isNavigationIntentDTO(metric.drilldown))) {
    return false
  }
  const scalar = (candidate: unknown) => candidate === null || (metric.unit === 'count'
    ? Number.isSafeInteger(candidate) && Number(candidate) >= 0
    : typeof candidate === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(candidate))
  if (!scalar(metric.value) || !scalar(metric.knownValue)
    || (metric.unit === 'quantity' ? !(metric.quantityUnit === null || (typeof metric.quantityUnit === 'string' && !!metric.quantityUnit.trim())) : metric.quantityUnit !== null)
    || (metric.unit === 'quantity' && metric.quantityUnit === null && (metric.value !== null || metric.knownValue !== null))
    || (metric.unit === 'ratio' && metric.status !== 'complete' && metric.knownValue !== null)) {
    return false
  }
  if (metric.status === 'complete')
    return metric.value !== null && metric.knownValue === metric.value && metric.missingSources.length === 0 && (metric.missingCount === null || metric.missingCount === 0)
  return metric.value === null
}
