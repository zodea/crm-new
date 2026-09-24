import type { RouteLocationRaw } from 'vue-router'
import type { QuantityProjectSnapshot } from '../quantity/read-model'
import type { ScheduleGroupView, ScheduleProjectView, ScheduleTaskView } from './read-model'
import type { DataOriginDTO } from '~/types/read-model'

export type ScheduleDrillSource = 'home' | 'schedule'
export const SCHEDULE_DRILL_QUERY_KEYS = ['from', 'group', 'task', 'stage', 'item', 'buildings', 'groupName', 'taskName', 'itemName', 'planStart', 'planFinish'] as const
export const SCHEDULE_FILTER_QUERY_KEYS = ['building', 'month', 'view', 'trade', 'assignee'] as const
export type ScheduleNavigationFilters = Partial<Record<typeof SCHEDULE_FILTER_QUERY_KEYS[number], string>>

export interface ScheduleDrillContext {
  source: ScheduleDrillSource
  origin?: DataOriginDTO
  projectId: string
  groupId: string
  taskId: string
  stageId: string
  itemId: string
  buildingId: string
  buildingIds: readonly string[]
  groupName: string
  taskName: string
  itemName: string
  planStart: string
  planFinish: string
  filters?: ScheduleNavigationFilters
}

function queryString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function scheduleFilterQuery(query: Record<string, unknown>): ScheduleNavigationFilters {
  return Object.fromEntries(SCHEDULE_FILTER_QUERY_KEYS.flatMap((key) => {
    const value = queryString(query[key])
    return value && (key !== 'view' || value === 'trade' || value === 'crew') ? [[key, value]] : []
  }))
}

export function scheduleReturnContextQuery(query: Record<string, unknown>): Record<string, string> {
  return { ...scheduleFilterQuery(query), ...Object.fromEntries(['group', 'task', 'stage', 'item', 'buildings'].flatMap(key => queryString(query[key]) ? [[key, queryString(query[key])]] : [])) }
}

export function scheduleSourceQuery(query: Record<string, unknown>): Record<string, string> {
  if (!parseScheduleDrillContext(query))
    return {}
  return Object.fromEntries(SCHEDULE_DRILL_QUERY_KEYS.flatMap(key => queryString(query[key]) ? [[key, queryString(query[key])]] : []))
}

export function buildQuantityDrillLocation(
  source: ScheduleDrillSource,
  group: ScheduleGroupView,
  task: ScheduleTaskView,
  origin?: DataOriginDTO,
  filters: ScheduleNavigationFilters = {},
): RouteLocationRaw {
  return {
    path: '/subcontract/quantity',
    query: {
      project: task.projectId,
      group: task.groupId,
      building: group.buildingIds[0] ?? undefined,
      buildings: group.buildingIds.join(',') || undefined,
      task: task.id,
      groupName: group.name,
      taskName: task.name,
      stage: task.stageId ?? undefined,
      item: task.itemIds[0] ?? undefined,
      itemName: task.itemNames.join('、') || undefined,
      planStart: task.plannedStart,
      planFinish: task.plannedFinish,
      from: source,
      ...(origin ? { origin } : {}),
      ...scheduleFilterQuery(filters),
    },
  }
}

export function parseScheduleDrillContext(query: Record<string, unknown>): ScheduleDrillContext | null {
  const source = queryString(query.from)
  const origin = queryString(query.origin)
  if (source !== 'home' && source !== 'schedule')
    return null
  if (['project', 'origin', ...SCHEDULE_DRILL_QUERY_KEYS, ...SCHEDULE_FILTER_QUERY_KEYS].some(key => query[key] != null && typeof query[key] !== 'string'))
    return null
  if (query.origin !== undefined && origin !== 'real' && origin !== 'demo')
    return null

  return {
    source,
    ...(origin === 'real' || origin === 'demo' ? { origin } : {}),
    projectId: queryString(query.project),
    groupId: queryString(query.group),
    taskId: queryString(query.task),
    stageId: queryString(query.stage),
    itemId: queryString(query.item),
    buildingId: queryString(query.building),
    buildingIds: queryString(query.buildings).split(',').filter(Boolean),
    groupName: queryString(query.groupName) || '楼栋分组',
    taskName: queryString(query.taskName) || '排程工序',
    itemName: queryString(query.itemName),
    planStart: queryString(query.planStart),
    planFinish: queryString(query.planFinish),
    filters: scheduleFilterQuery(query),
  }
}

export function buildScheduleReturnLocation(context: ScheduleDrillContext): RouteLocationRaw {
  const preserved = {
    ...context.filters,
    ...(context.stageId ? { stage: context.stageId } : {}),
    ...(context.itemId ? { item: context.itemId } : {}),
    ...(context.buildingIds.length ? { buildings: context.buildingIds.join(',') } : {}),
  }
  if (context.source === 'home') {
    return {
      path: '/',
      query: {
        project: context.projectId,
        group: context.groupId,
        task: context.taskId,
        ...(context.origin ? { origin: context.origin } : {}),
        ...preserved,
      },
    }
  }

  return {
    path: '/schedule',
    query: {
      project: context.projectId,
      group: context.groupId,
      task: context.taskId,
      ...(context.origin ? { origin: context.origin } : {}),
      ...preserved,
    },
  }
}

/** 来源名称仅供显示，所有筛选身份都必须仍属于该中央工序。 */
export function validateScheduleDrillContext(context: ScheduleDrillContext, schedule: ScheduleProjectView | null, quantity: QuantityProjectSnapshot): string {
  if (!schedule || schedule.id !== context.projectId || quantity.projectId !== context.projectId)
    return '来源项目已失效或不匹配，请从施工进度重新选择'
  const group = schedule.groups.find(row => row.id === context.groupId)
  const task = group?.tasks.find(row => row.id === context.taskId)
  if (!group || !task)
    return '来源分组或工序已删除，请从施工进度重新选择'
  if (!task.hasQty || !context.stageId || task.stageId !== context.stageId || !quantity.stages.some(stage => stage.id === context.stageId))
    return '来源阶段已失效或与工序不匹配，请从原工序重新打开'
  if (context.itemId && !task.itemIds.includes(context.itemId))
    return '来源分项与工序不匹配，请从原工序重新打开'
  if (!context.buildingIds.length || context.buildingIds.some(id => !group.buildingIds.includes(id) || !quantity.buildings.some(building => building.id === id))
    || group.buildingIds.some(id => !context.buildingIds.includes(id))
    || (context.buildingId && !group.buildingIds.includes(context.buildingId))) {
    return '来源楼栋范围已变化，请从原工序重新打开'
  }
  return ''
}
