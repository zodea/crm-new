import type { LocationQuery, RouteLocationRaw } from 'vue-router'
import type { ScheduleGroupView, ScheduleTaskView } from './read-model'
import type { DataOriginDTO } from '~/types/read-model'

export type ScheduleDrillSource = 'home' | 'schedule'

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
}

function queryString(value: unknown): string {
  const source = Array.isArray(value) ? value[0] : value
  return source == null ? '' : String(source)
}

export function buildQuantityDrillLocation(
  source: ScheduleDrillSource,
  group: ScheduleGroupView,
  task: ScheduleTaskView,
  origin?: DataOriginDTO,
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
    },
  }
}

export function parseScheduleDrillContext(query: LocationQuery): ScheduleDrillContext | null {
  const source = queryString(query.from)
  const origin = queryString(query.origin)
  if (source !== 'home' && source !== 'schedule')
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
  }
}

export function buildScheduleReturnLocation(context: ScheduleDrillContext): RouteLocationRaw {
  if (context.source === 'home') {
    return {
      path: '/',
      query: {
        project: context.projectId,
        group: context.groupId,
        task: context.taskId,
        ...(context.origin ? { origin: context.origin } : {}),
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
    },
  }
}
